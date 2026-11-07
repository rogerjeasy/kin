-- Reading a letter the parent holds up, and checking a demand for money
-- (docs/architecture.md sections 9.4, 9.5 and 11.4 to 11.5).
--
-- Both write through narrow operations, like caregiver billing: the web app
-- reads the document and decides the verdict with plain code, and these
-- functions record the result for the members whose role may.

-- A document Kin read is kept as what it read, not as a file: no bucket holds
-- the photograph, so a real circle's document row carries its reading instead
-- of an S3 key.
ALTER TABLE public.documents DROP CONSTRAINT documents_stored_or_simulated;
--> statement-breakpoint
ALTER TABLE public.documents ADD CONSTRAINT documents_stored_or_read
  CHECK (storage_key IS NOT NULL OR simulated OR extraction IS NOT NULL);
--> statement-breakpoint

-- Records a reading and, when it holds a bill for someone Kin can name, the
-- bill, waiting for a person to review it. A bill that repeats an open one
-- is recorded as a duplicate of it. The parent, the organizer and the
-- contributors may; a caregiver or an observer may not.
CREATE FUNCTION kin_private.add_letter(
  p_circle uuid, p_kind public.document_kind, p_payee uuid, p_sender text, p_cents bigint, p_due date,
  p_extraction jsonb, p_confidence real
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_circle public.circles;
    v_member uuid := kin_private.my_member_id(p_circle);
    v_today date;
    v_document uuid := gen_random_uuid();
    v_payee public.payees;
    v_bill uuid;
    v_state public.bill_state;
    v_duplicate uuid;
  BEGIN
    IF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor', 'parent') THEN
      RAISE EXCEPTION 'kin: reading letters refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: reading letters refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF jsonb_typeof(p_extraction) IS DISTINCT FROM 'object'
       OR (p_sender IS NOT NULL AND length(btrim(p_sender)) NOT BETWEEN 1 AND 80)
       OR (p_cents IS NOT NULL AND p_cents <= 0)
       OR p_confidence NOT BETWEEN 0 AND 1 THEN
      RAISE EXCEPTION 'kin: the reading is not valid' USING ERRCODE = 'check_violation';
    END IF;
    v_today := (coalesce(v_circle.clock_at, now()) AT TIME ZONE v_circle.timezone)::date;

    INSERT INTO public.documents (id, circle_id, kind, uploaded_by, extraction, confidence, simulated)
      VALUES (v_document, p_circle, p_kind, v_member, p_extraction, p_confidence, v_circle.demo);

    IF p_kind = 'bill' AND p_cents IS NOT NULL AND p_sender IS NOT NULL THEN
      IF p_payee IS NOT NULL THEN
        -- A letter can only be about someone the family pays, never a caregiver.
        SELECT * INTO v_payee FROM public.payees WHERE circle_id = p_circle AND id = p_payee AND member_id IS NULL;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'kin: reading letters refused' USING ERRCODE = 'insufficient_privilege';
        END IF;
      ELSE
        INSERT INTO public.payees (id, circle_id, name, category, status)
          VALUES (gen_random_uuid(), p_circle, btrim(p_sender), 'other', 'new') RETURNING * INTO v_payee;
      END IF;
      SELECT id INTO v_duplicate FROM public.bills
        WHERE circle_id = p_circle AND payee_id = v_payee.id AND amount_cents = p_cents AND due_on IS NOT DISTINCT FROM p_due
          AND state NOT IN ('rejected', 'duplicate')
        ORDER BY created_at, id LIMIT 1;
      v_bill := gen_random_uuid();
      INSERT INTO public.bills (id, circle_id, payee_id, document_id, amount_cents, due_on, received_on)
        VALUES (v_bill, p_circle, v_payee.id, v_document, p_cents, p_due, v_today);
      UPDATE public.bills SET state = 'extracted' WHERE id = v_bill AND circle_id = p_circle;
      IF v_duplicate IS NOT NULL THEN
        UPDATE public.bills SET state = 'duplicate', duplicate_of = v_duplicate WHERE id = v_bill AND circle_id = p_circle;
        v_state := 'duplicate';
      ELSE
        UPDATE public.bills SET state = 'needs_review' WHERE id = v_bill AND circle_id = p_circle;
        v_state := 'needs_review';
      END IF;
    END IF;

    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_member, 'letter.read', 'document', v_document,
              jsonb_build_object('billId', v_bill, 'kind', p_kind), 'web');
    RETURN jsonb_build_object('documentId', v_document, 'billId', v_bill, 'billState', v_state,
                              'payeeId', v_payee.id, 'duplicateOf', v_duplicate);
  END
  $$;
--> statement-breakpoint

-- Records a demand Kin checked, the verdict plain code reached, and the words
-- Kin spoke about it, and tells every member who sees the circle's money. The
-- verdict is the web app's, reached by `checkClaim` in packages/domain; the
-- database insists only that the facts it points at belong to this circle (the
-- composite foreign keys) and that a caregiver or observer cannot raise one.
CREATE FUNCTION kin_private.record_claim_check(
  p_circle uuid, p_payee uuid, p_claimed bigint, p_claim text, p_found uuid,
  p_verdict public.claim_verdict, p_topic text, p_spoken text
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_circle public.circles;
    v_member uuid := kin_private.my_member_id(p_circle);
    v_today date;
    v_alerted uuid[];
    v_id uuid := gen_random_uuid();
    v_told uuid;
  BEGIN
    IF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor', 'parent') THEN
      RAISE EXCEPTION 'kin: claim checks refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: claim checks refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF length(btrim(p_claim)) NOT BETWEEN 1 AND 500 OR (p_claimed IS NOT NULL AND p_claimed <= 0)
       OR p_spoken IS NULL OR length(p_spoken) NOT BETWEEN 1 AND 600 THEN
      RAISE EXCEPTION 'kin: the claim is not valid' USING ERRCODE = 'check_violation';
    END IF;
    v_today := (coalesce(v_circle.clock_at, now()) AT TIME ZONE v_circle.timezone)::date;
    SELECT coalesce(array_agg(id ORDER BY joined_at, id), '{}') INTO v_alerted FROM public.members
      WHERE circle_id = p_circle AND status = 'active' AND role IN ('organizer', 'contributor', 'parent', 'observer');
    INSERT INTO public.claim_checks (id, circle_id, checked_on, payee_id, claimed_cents, claim, found_entry_id, verdict, alerted)
      VALUES (v_id, p_circle, v_today, p_payee, p_claimed, btrim(p_claim), p_found, p_verdict, v_alerted);
    FOREACH v_told IN ARRAY v_alerted LOOP
      INSERT INTO public.narrations (id, circle_id, member_id, topic, cents, claim_check_id, spoken_text, state, said_on)
        VALUES (gen_random_uuid(), p_circle, v_told, p_topic, p_claimed, v_id, p_spoken, 'queued', v_today);
    END LOOP;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_member, 'claim_check.recorded', 'claim_check', v_id,
              jsonb_build_object('verdict', p_verdict), 'web');
    RETURN v_id;
  END
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.add_letter(uuid, public.document_kind, uuid, text, bigint, date, jsonb, real) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.record_claim_check(uuid, uuid, bigint, text, uuid, public.claim_verdict, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.add_letter(uuid, public.document_kind, uuid, text, bigint, date, jsonb, real) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.record_claim_check(uuid, uuid, bigint, text, uuid, public.claim_verdict, text, text) TO kin_app;

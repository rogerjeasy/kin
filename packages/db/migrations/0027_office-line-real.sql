-- A real phone call to the family office line (docs/feature-proposals.md section 2).
--
-- The web simulator records its calls as a signed-in person (record_office_call,
-- migration 0023). The phone service has no person: it acts as Kin's service
-- identity, limited to the one circle the dialled number belongs to
-- (kin_private.circle_id()). This operation records the same three things in
-- one step -- the call, the claim check it produced and the alert to every
-- member who sees the circle's money -- for that identity only.
--
-- A call that came in over the telephone is never labelled simulated: the call
-- is real even in a demo circle, where only the money is not. The audit entry
-- names the service as its actor and the phone as its origin.
CREATE FUNCTION kin_private.record_office_line_call(
  p_circle uuid, p_number text, p_caller text, p_org text, p_claimed bigint, p_purpose text, p_reference text,
  p_transcript jsonb, p_signals text[],
  p_payee uuid, p_found uuid, p_verdict public.claim_verdict, p_topic text, p_spoken text, p_claim text
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_circle public.circles;
    v_today date;
    v_alerted uuid[];
    v_check uuid := gen_random_uuid();
    v_call uuid := gen_random_uuid();
    v_told uuid;
  BEGIN
    IF p_circle IS NULL OR p_circle IS DISTINCT FROM kin_private.circle_id() THEN
      RAISE EXCEPTION 'kin: office line refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: office line refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF jsonb_typeof(p_transcript) IS DISTINCT FROM 'array' OR jsonb_array_length(p_transcript) > 60
       OR (p_number IS NOT NULL AND length(p_number) > 32)
       OR (p_caller IS NOT NULL AND length(p_caller) > 200) OR (p_org IS NOT NULL AND length(p_org) > 200)
       OR (p_purpose IS NOT NULL AND length(p_purpose) > 200) OR (p_reference IS NOT NULL AND length(p_reference) > 200)
       OR (p_claimed IS NOT NULL AND p_claimed <= 0)
       OR length(btrim(p_claim)) NOT BETWEEN 1 AND 500
       OR p_spoken IS NULL OR length(p_spoken) NOT BETWEEN 1 AND 600 THEN
      RAISE EXCEPTION 'kin: the call is not valid' USING ERRCODE = 'check_violation';
    END IF;
    v_today := (coalesce(v_circle.clock_at, now()) AT TIME ZONE v_circle.timezone)::date;

    SELECT coalesce(array_agg(id ORDER BY joined_at, id), '{}') INTO v_alerted FROM public.members
      WHERE circle_id = p_circle AND status = 'active' AND role IN ('organizer', 'contributor', 'parent', 'observer');
    INSERT INTO public.claim_checks (id, circle_id, checked_on, payee_id, claimed_cents, claim, found_entry_id, verdict, alerted)
      VALUES (v_check, p_circle, v_today, p_payee, p_claimed, btrim(p_claim), p_found, p_verdict, v_alerted);
    FOREACH v_told IN ARRAY v_alerted LOOP
      INSERT INTO public.narrations (id, circle_id, member_id, topic, cents, claim_check_id, spoken_text, state, said_on)
        VALUES (gen_random_uuid(), p_circle, v_told, p_topic, p_claimed, v_check, p_spoken, 'queued', v_today);
    END LOOP;
    INSERT INTO public.office_calls (id, circle_id, caller_number, caller_name, organization, claimed_cents, purpose, reference,
                                     transcript, verdict, pressure_signals, simulated, claim_check_id, called_on)
      VALUES (v_call, p_circle, p_number, p_caller, p_org, p_claimed, p_purpose, p_reference,
              p_transcript, p_verdict, coalesce(p_signals, '{}'), false, v_check, v_today);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'service', NULL, 'office_call.recorded', 'office_call', v_call,
              jsonb_build_object('verdict', p_verdict, 'simulated', false), 'phone');
    RETURN jsonb_build_object('callId', v_call, 'claimCheckId', v_check);
  END
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.record_office_line_call(uuid, text, text, text, bigint, text, text, jsonb, text[], uuid, uuid, public.claim_verdict, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.record_office_line_call(uuid, text, text, text, bigint, text, text, jsonb, text[], uuid, uuid, public.claim_verdict, text, text, text) TO kin_service;

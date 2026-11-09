-- Care agreements: who may see and write the written agreement between the
-- person who needs care and a caregiver, and the rules the database holds to.
-- Tables care_agreements and care_agreement_signatures, and their checks, come
-- from the generated migration before this one; this file adds their access
-- rules, the triggers that fix what was written, and the operations that write.
--
-- Plain code in packages/domain decides what an agreement covers and when it
-- governs (care-agreement.ts). The database holds the same terms a second time
-- (the checks on the table, among them the refusal of a spouse) and keeps the
-- record: a signature is written once; an agreement's terms never change; only
-- a draft is withdrawn, and an agreement that was signed by both sides is ended
-- on a day, once, never withdrawn, so what it covered stays on the record.
--
-- Refusals that screens word, by SQLSTATE:
--   42501  the person may not do this, or the agreement is not theirs to see
--   23514  the terms are not an agreement the template can hold (a spouse, no duties, an hour or a rate out of range...)
--   KC001  the agreement is not in a state that allows this (withdrawn, ended, not signed by both sides yet, or already signed by both)
--   KC002  the agreement was ended already, on another day
--   KC003  someone else already signed for that side
ALTER TABLE public.care_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_agreement_signatures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Like every circle table: the service acts for the circle it names, and the
-- provisioner fills the circle it is creating. Everyone who sees the circle's
-- money reads every agreement; a caregiver reads only their own.
CREATE POLICY service_own_circle ON public.care_agreements FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY service_own_circle ON public.care_agreement_signatures FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY provisioner_new_circle ON public.care_agreements FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
CREATE POLICY provisioner_new_circle ON public.care_agreement_signatures FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
CREATE POLICY app_member_read ON public.care_agreements FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id) OR caregiver_member_id = kin_private.my_member_id(circle_id));
-- A signature is as visible as the agreement it is on: the subselect is read under the same policy.
CREATE POLICY app_member_read ON public.care_agreement_signatures FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id) OR EXISTS (
    SELECT 1 FROM public.care_agreements a
    WHERE a.circle_id = care_agreement_signatures.circle_id AND a.id = care_agreement_signatures.agreement_id
  ));
--> statement-breakpoint

-- Only the operations below write an agreement or a signature. The worker reads
-- them, to hold a caregiver's pay to the work an agreement covers.
GRANT SELECT ON public.care_agreements, public.care_agreement_signatures TO kin_app, kin_service;
GRANT INSERT ON public.care_agreements, public.care_agreement_signatures TO kin_provisioner;
--> statement-breakpoint

-- Nothing here is ever deleted, and a signature is never changed.
CREATE TRIGGER no_delete BEFORE DELETE ON public.care_agreements
  FOR EACH ROW EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER no_delete_truncate BEFORE TRUNCATE ON public.care_agreements
  FOR EACH STATEMENT EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON public.care_agreement_signatures
  FOR EACH ROW EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON public.care_agreement_signatures
  FOR EACH STATEMENT EXECUTE FUNCTION kin_private.refuse_change();
--> statement-breakpoint

-- What an agreement says never changes. Only its state moves, from draft to
-- withdrawn and never back, and the day the family ended it is set once.
CREATE FUNCTION kin_private.assert_care_agreement_fixed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF (to_jsonb(NEW) - ARRAY['state', 'ended_on']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state', 'ended_on']) THEN
      RAISE EXCEPTION 'kin: care agreement % cannot change what it says after it is written', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.state IS DISTINCT FROM OLD.state AND NOT (OLD.state = 'draft' AND NEW.state = 'withdrawn') THEN
      RAISE EXCEPTION 'kin: care agreement % cannot move from % to %', OLD.id, OLD.state, NEW.state USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.ended_on IS NOT NULL AND NEW.ended_on IS DISTINCT FROM OLD.ended_on THEN
      RAISE EXCEPTION 'kin: care agreement % was ended and cannot be ended again', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER terms_fixed BEFORE UPDATE ON public.care_agreements
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_care_agreement_fixed();
--> statement-breakpoint

-- The caregiver is who the agreement says: the payee is theirs, it is a
-- caregiver's payee with an agreed rate, and the member's seat is a caregiver's.
-- Checked on every insert, whoever writes it.
CREATE FUNCTION kin_private.assert_care_agreement_parties() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM public.payees p JOIN public.members m ON m.circle_id = p.circle_id AND m.id = p.member_id
      WHERE p.circle_id = NEW.circle_id AND p.id = NEW.payee_id AND p.member_id = NEW.caregiver_member_id
        AND p.caregiver_rate_cents_per_hour IS NOT NULL AND m.role = 'caregiver'
    ) THEN
      RAISE EXCEPTION 'kin: a care agreement names a caregiver and their own payee' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER parties_are_the_caregiver BEFORE INSERT ON public.care_agreements
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_care_agreement_parties();
--> statement-breakpoint

-- A signature is given in the seat the person holds: the caregiver as the
-- caregiver the agreement names, the parent for themselves, the organizer for
-- the parent. Only a draft takes signatures. Checked on every insert.
CREATE FUNCTION kin_private.assert_care_signature_fits() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_agreement public.care_agreements;
    v_role public.circle_role;
  BEGIN
    SELECT * INTO v_agreement FROM public.care_agreements WHERE circle_id = NEW.circle_id AND id = NEW.agreement_id;
    SELECT role INTO v_role FROM public.members WHERE circle_id = NEW.circle_id AND id = NEW.member_id;
    IF v_agreement.id IS NULL OR v_agreement.state <> 'draft' OR v_agreement.ended_on IS NOT NULL THEN
      RAISE EXCEPTION 'kin: care agreement is not open for signatures' USING ERRCODE = 'KC001';
    END IF;
    IF NOT ((NEW.capacity = 'caregiver' AND v_role = 'caregiver' AND NEW.member_id = v_agreement.caregiver_member_id)
         OR (NEW.capacity = 'care_recipient' AND v_role = 'parent')
         OR (NEW.capacity = 'representative' AND v_role = 'organizer')) THEN
      RAISE EXCEPTION 'kin: that seat cannot sign in that capacity' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER signature_fits_the_seat BEFORE INSERT ON public.care_agreement_signatures
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_care_signature_fits();
--> statement-breakpoint

-- Signed by the caregiver and by the care recipient or someone acting for them.
CREATE FUNCTION kin_private.care_agreement_fully_signed(p_circle uuid, p_agreement uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (SELECT 1 FROM public.care_agreement_signatures WHERE circle_id = p_circle AND agreement_id = p_agreement AND capacity = 'caregiver')
       AND EXISTS (SELECT 1 FROM public.care_agreement_signatures WHERE circle_id = p_circle AND agreement_id = p_agreement AND capacity IN ('care_recipient', 'representative'))
  $$;
--> statement-breakpoint

-- Writes a draft agreement. The organizer only, for a caregiver of this circle
-- and their own payee. `p_terms` is the domain's CareAgreementTerms as JSON;
-- every field is checked here again, the table's checks refuse the rest, and
-- a spouse is refused with its own message. Proposing the same terms again
-- while that draft stands returns it.
CREATE FUNCTION kin_private.propose_care_agreement(p_circle uuid, p_terms jsonb) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_id uuid := gen_random_uuid();
    v_existing uuid;
    v_payee uuid;
    v_caregiver uuid;
    v_relation text;
    v_duties text[];
    v_end_term text;
    v_ends_on date;
    v_minutes integer;
    v_rate bigint;
    v_starts date;
    v_payer text;
    v_state text;
    v_key text;
  BEGIN
    IF kin_private.my_role(p_circle) IS DISTINCT FROM 'organizer' OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: proposing a care agreement refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active' FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: proposing a care agreement refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF jsonb_typeof(p_terms) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'kin: the terms are not an object' USING ERRCODE = 'check_violation';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(p_terms) LOOP
      IF v_key NOT IN ('payeeId', 'caregiverMemberId', 'caregiverRelation', 'duties', 'weeklyMinutes', 'rateCentsPerHour', 'startsOn', 'endTerm', 'endsOn', 'payer', 'state') THEN
        RAISE EXCEPTION 'kin: unknown term %', v_key USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
    IF jsonb_typeof(p_terms -> 'payeeId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_terms -> 'caregiverMemberId') IS DISTINCT FROM 'string'
       OR jsonb_typeof(p_terms -> 'caregiverRelation') IS DISTINCT FROM 'string' OR jsonb_typeof(p_terms -> 'duties') IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_terms -> 'weeklyMinutes') IS DISTINCT FROM 'number' OR jsonb_typeof(p_terms -> 'rateCentsPerHour') IS DISTINCT FROM 'number'
       OR jsonb_typeof(p_terms -> 'startsOn') IS DISTINCT FROM 'string' OR jsonb_typeof(p_terms -> 'endTerm') IS DISTINCT FROM 'string'
       OR jsonb_typeof(p_terms -> 'endsOn') NOT IN ('string', 'null') OR jsonb_typeof(p_terms -> 'payer') IS DISTINCT FROM 'string'
       OR jsonb_typeof(p_terms -> 'state') IS DISTINCT FROM 'string'
       OR (p_terms ->> 'payeeId') !~ '^[0-9a-f-]{36}$' OR (p_terms ->> 'caregiverMemberId') !~ '^[0-9a-f-]{36}$'
       OR (p_terms ->> 'weeklyMinutes') !~ '^[0-9]{1,5}$' OR (p_terms ->> 'rateCentsPerHour') !~ '^[0-9]{1,10}$'
       OR (p_terms ->> 'startsOn') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR coalesce(p_terms ->> 'endsOn', '2000-01-01') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_terms -> 'duties') AS d WHERE jsonb_typeof(d) IS DISTINCT FROM 'string') THEN
      RAISE EXCEPTION 'kin: the terms are not a care agreement' USING ERRCODE = 'check_violation';
    END IF;
    v_payee := (p_terms ->> 'payeeId')::uuid;
    v_caregiver := (p_terms ->> 'caregiverMemberId')::uuid;
    v_relation := p_terms ->> 'caregiverRelation';
    IF v_relation = 'spouse' THEN
      RAISE EXCEPTION 'kin: an agreement with a spouse is not drafted' USING ERRCODE = 'check_violation';
    END IF;
    -- Trimmed as the domain trims them, so what is stored is what the template prints.
    SELECT array_agg(btrim(d) ORDER BY n) INTO v_duties FROM jsonb_array_elements_text(p_terms -> 'duties') WITH ORDINALITY AS t(d, n);
    IF v_duties IS NULL THEN
      RAISE EXCEPTION 'kin: a care agreement lists at least one duty' USING ERRCODE = 'check_violation';
    END IF;
    v_end_term := p_terms ->> 'endTerm';
    v_ends_on := (p_terms ->> 'endsOn')::date;
    v_minutes := (p_terms ->> 'weeklyMinutes')::integer;
    v_rate := (p_terms ->> 'rateCentsPerHour')::bigint;
    v_starts := (p_terms ->> 'startsOn')::date;
    v_payer := p_terms ->> 'payer';
    v_state := p_terms ->> 'state';
    IF NOT EXISTS (
      SELECT 1 FROM public.payees p JOIN public.members m ON m.circle_id = p.circle_id AND m.id = p.member_id
      WHERE p.circle_id = p_circle AND p.id = v_payee AND p.member_id = v_caregiver
        AND p.caregiver_rate_cents_per_hour IS NOT NULL AND m.role = 'caregiver' AND m.status = 'active'
    ) THEN
      RAISE EXCEPTION 'kin: a care agreement names an active caregiver and their own payee' USING ERRCODE = 'check_violation';
    END IF;

    SELECT id INTO v_existing FROM public.care_agreements
      WHERE circle_id = p_circle AND payee_id = v_payee AND state = 'draft' AND ended_on IS NULL
        AND caregiver_member_id = v_caregiver AND caregiver_relation = v_relation AND duties = v_duties AND weekly_minutes = v_minutes
        AND rate_cents_per_hour = v_rate AND starts_on = v_starts AND end_term = v_end_term AND ends_on IS NOT DISTINCT FROM v_ends_on
        AND payer = v_payer AND us_state = v_state
      LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;

    INSERT INTO public.care_agreements (id, circle_id, payee_id, caregiver_member_id, caregiver_relation, duties, weekly_minutes, rate_cents_per_hour,
                                        starts_on, end_term, ends_on, payer, us_state, simulated, created_by)
      VALUES (v_id, p_circle, v_payee, v_caregiver, v_relation, v_duties, v_minutes, v_rate, v_starts, v_end_term, v_ends_on, v_payer, v_state, v_circle.demo, v_me);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'care_agreement.proposed', 'care_agreement', v_id,
              jsonb_build_object('payeeId', v_payee, 'startsOn', v_starts), 'web');
    RETURN v_id;
  END
  $$;
--> statement-breakpoint

-- Signs a draft in the seat the person holds: the caregiver the agreement names,
-- as the caregiver; the parent, as the care recipient; an organizer, as the
-- representative of the parent. The day is the circle's own, never one the
-- caller sends. Signing twice changes nothing.
CREATE FUNCTION kin_private.sign_care_agreement(p_circle uuid, p_agreement uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_agreement public.care_agreements;
    v_capacity text;
    v_now timestamptz;
  BEGIN
    IF v_role IS NULL OR v_me IS NULL OR v_role NOT IN ('caregiver', 'parent', 'organizer') THEN
      RAISE EXCEPTION 'kin: signing a care agreement refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    SELECT * INTO v_agreement FROM public.care_agreements WHERE circle_id = p_circle AND id = p_agreement FOR UPDATE;
    IF v_circle.id IS NULL OR v_agreement.id IS NULL OR (v_role = 'caregiver' AND v_agreement.caregiver_member_id <> v_me) THEN
      RAISE EXCEPTION 'kin: signing a care agreement refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_capacity := CASE v_role WHEN 'caregiver' THEN 'caregiver' WHEN 'parent' THEN 'care_recipient' ELSE 'representative' END;
    IF v_agreement.state <> 'draft' OR v_agreement.ended_on IS NOT NULL THEN
      RAISE EXCEPTION 'kin: the care agreement is not open for signatures' USING ERRCODE = 'KC001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.care_agreement_signatures WHERE agreement_id = p_agreement AND member_id = v_me) THEN
      RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.care_agreement_signatures WHERE agreement_id = p_agreement AND capacity = v_capacity) THEN
      RAISE EXCEPTION 'kin: someone already signed for that side' USING ERRCODE = 'KC003';
    END IF;
    v_now := date_trunc('second', coalesce(v_circle.clock_at, now()));
    INSERT INTO public.care_agreement_signatures (id, circle_id, agreement_id, member_id, capacity, method, signed_on, signed_at)
      VALUES (gen_random_uuid(), p_circle, p_agreement, v_me, v_capacity, 'app', (v_now AT TIME ZONE v_circle.timezone)::date, v_now);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'care_agreement.signed', 'care_agreement', p_agreement,
              jsonb_build_object('capacity', v_capacity), 'web');
  END
  $$;
--> statement-breakpoint

-- Takes back a draft before both sides have signed it. The organizer only. An
-- agreement both sides signed is ended, never withdrawn: what it covered stays
-- covered. Withdrawing twice changes nothing.
CREATE FUNCTION kin_private.withdraw_care_agreement(p_circle uuid, p_agreement uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_agreement public.care_agreements;
  BEGIN
    IF kin_private.my_role(p_circle) IS DISTINCT FROM 'organizer' OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: withdrawing a care agreement refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT a.* INTO v_agreement FROM public.care_agreements a JOIN public.circles c ON c.id = a.circle_id AND c.status = 'active'
      WHERE a.circle_id = p_circle AND a.id = p_agreement FOR UPDATE OF a;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: withdrawing a care agreement refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_agreement.state = 'withdrawn' THEN
      RETURN;
    END IF;
    IF kin_private.care_agreement_fully_signed(p_circle, p_agreement) OR v_agreement.ended_on IS NOT NULL THEN
      RAISE EXCEPTION 'kin: a signed care agreement is ended, not withdrawn' USING ERRCODE = 'KC001';
    END IF;
    UPDATE public.care_agreements SET state = 'withdrawn' WHERE circle_id = p_circle AND id = p_agreement;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'care_agreement.withdrawn', 'care_agreement', p_agreement, '{}'::jsonb, 'web');
  END
  $$;
--> statement-breakpoint

-- Ends an agreement both sides signed, after the last day it covers. The
-- organizer only. The day is not in the past on the circle's clock and not
-- before the agreement began to cover work; it is set once, and asking again
-- for the same day changes nothing.
CREATE FUNCTION kin_private.end_care_agreement(p_circle uuid, p_agreement uuid, p_ended_on date) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_agreement public.care_agreements;
    v_today date;
    v_from date;
  BEGIN
    IF kin_private.my_role(p_circle) IS DISTINCT FROM 'organizer' OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: ending a care agreement refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    SELECT * INTO v_agreement FROM public.care_agreements WHERE circle_id = p_circle AND id = p_agreement FOR UPDATE;
    IF v_circle.id IS NULL OR v_agreement.id IS NULL OR p_ended_on IS NULL THEN
      RAISE EXCEPTION 'kin: ending a care agreement refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_agreement.state <> 'draft' OR NOT kin_private.care_agreement_fully_signed(p_circle, p_agreement) THEN
      RAISE EXCEPTION 'kin: only a care agreement both sides signed is ended' USING ERRCODE = 'KC001';
    END IF;
    IF v_agreement.ended_on IS NOT NULL THEN
      IF v_agreement.ended_on = p_ended_on THEN
        RETURN;
      END IF;
      RAISE EXCEPTION 'kin: the care agreement was ended already' USING ERRCODE = 'KC002';
    END IF;
    v_today := (coalesce(v_circle.clock_at, now()) AT TIME ZONE v_circle.timezone)::date;
    SELECT greatest(v_agreement.starts_on, max(signed_on)) INTO v_from FROM public.care_agreement_signatures WHERE agreement_id = p_agreement;
    IF p_ended_on < v_today OR p_ended_on < v_from THEN
      RAISE EXCEPTION 'kin: the care agreement cannot end before today or before it began to cover work' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.care_agreements SET ended_on = p_ended_on WHERE circle_id = p_circle AND id = p_agreement;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'care_agreement.ended', 'care_agreement', p_agreement,
              jsonb_build_object('endedOn', p_ended_on), 'web');
  END
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.assert_care_agreement_fixed() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.assert_care_agreement_parties() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.assert_care_signature_fits() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.care_agreement_fully_signed(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.propose_care_agreement(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.sign_care_agreement(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.withdraw_care_agreement(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.end_care_agreement(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.care_agreement_fully_signed(uuid, uuid) TO kin_service;
GRANT EXECUTE ON FUNCTION kin_private.propose_care_agreement(uuid, jsonb) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.sign_care_agreement(uuid, uuid) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.withdraw_care_agreement(uuid, uuid) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.end_care_agreement(uuid, uuid, date) TO kin_app;

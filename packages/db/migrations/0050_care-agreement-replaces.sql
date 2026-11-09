-- One care agreement at a time, at the caregiver's pay rate.
--
-- An agreement states the rate Kin pays the caregiver: proposing one at
-- another rate is refused (KC004), and so is signing a draft whose rate the
-- organizer has changed since. When a newer agreement for the same caregiver
-- gets its last signature, it replaces the earlier ones: each ends on the day
-- before the newer one begins to cover work, and the audit log says which
-- replaced it. A signed agreement that would still cover that day and cannot
-- be ended before it refuses the signature instead (KC005).
--
-- packages/domain/src/care-agreement.ts holds the same rules in plain code:
-- workCoverage covers a day only at the rate the agreement states, and
-- replacedBy finds the agreement that replaced another.

CREATE OR REPLACE FUNCTION kin_private.propose_care_agreement(p_circle uuid, p_terms jsonb) RETURNS uuid
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
    v_pay_rate bigint;
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
    SELECT caregiver_rate_cents_per_hour INTO v_pay_rate FROM public.payees WHERE circle_id = p_circle AND id = v_payee;

    SELECT id INTO v_existing FROM public.care_agreements
      WHERE circle_id = p_circle AND payee_id = v_payee AND state = 'draft' AND ended_on IS NULL
        AND caregiver_member_id = v_caregiver AND caregiver_relation = v_relation AND duties = v_duties AND weekly_minutes = v_minutes
        AND rate_cents_per_hour = v_rate AND starts_on = v_starts AND end_term = v_end_term AND ends_on IS NOT DISTINCT FROM v_ends_on
        AND payer = v_payer AND us_state = v_state
      LIMIT 1;
    IF v_existing IS NOT NULL AND v_rate = v_pay_rate THEN
      RETURN v_existing;
    END IF;

    INSERT INTO public.care_agreements (id, circle_id, payee_id, caregiver_member_id, caregiver_relation, duties, weekly_minutes, rate_cents_per_hour,
                                        starts_on, end_term, ends_on, payer, us_state, simulated, created_by)
      VALUES (v_id, p_circle, v_payee, v_caregiver, v_relation, v_duties, v_minutes, v_rate, v_starts, v_end_term, v_ends_on, v_payer, v_state, v_circle.demo, v_me);
    -- The agreement states the rate Kin pays the caregiver, and nothing else.
    -- Asked after the table's own checks, so a rate no agreement can hold is
    -- refused as invalid; the refusal takes the row back with it.
    IF v_rate IS DISTINCT FROM v_pay_rate THEN
      RAISE EXCEPTION 'kin: a care agreement states the caregiver''s pay rate' USING ERRCODE = 'KC004';
    END IF;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'care_agreement.proposed', 'care_agreement', v_id,
              jsonb_build_object('payeeId', v_payee, 'startsOn', v_starts), 'web');
    RETURN v_id;
  END
  $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION kin_private.sign_care_agreement(p_circle uuid, p_agreement uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_agreement public.care_agreements;
    v_capacity text;
    v_now timestamptz;
    v_from date;
    v_old public.care_agreements;
    v_old_from date;
    v_old_until date;
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
    -- The pay rate may have changed since the draft was written: nobody signs to a rate Kin would not pay.
    IF v_agreement.rate_cents_per_hour IS DISTINCT FROM (SELECT caregiver_rate_cents_per_hour FROM public.payees WHERE circle_id = p_circle AND id = v_agreement.payee_id) THEN
      RAISE EXCEPTION 'kin: the care agreement no longer states the caregiver''s pay rate' USING ERRCODE = 'KC004';
    END IF;
    v_now := date_trunc('second', coalesce(v_circle.clock_at, now()));
    INSERT INTO public.care_agreement_signatures (id, circle_id, agreement_id, member_id, capacity, method, signed_on, signed_at)
      VALUES (gen_random_uuid(), p_circle, p_agreement, v_me, v_capacity, 'app', (v_now AT TIME ZONE v_circle.timezone)::date, v_now);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'care_agreement.signed', 'care_agreement', p_agreement,
              jsonb_build_object('capacity', v_capacity), 'web');
    IF NOT kin_private.care_agreement_fully_signed(p_circle, p_agreement) THEN
      RETURN;
    END IF;

    -- The last signature: this agreement replaces the caregiver's earlier ones,
    -- which end on the day before it begins to cover work, so one agreement at
    -- most covers any day. One that would still cover that day and cannot be
    -- ended before it (it starts that day or later, or was ended already on a
    -- later day) is not replaced: the signature is refused.
    SELECT greatest(v_agreement.starts_on, max(signed_on)) INTO v_from FROM public.care_agreement_signatures WHERE agreement_id = p_agreement;
    FOR v_old IN
      SELECT a.* FROM public.care_agreements a
        WHERE a.circle_id = p_circle AND a.payee_id = v_agreement.payee_id AND a.id <> p_agreement AND a.state = 'draft'
          AND kin_private.care_agreement_fully_signed(p_circle, a.id)
        ORDER BY a.created_at, a.id
        FOR UPDATE OF a
    LOOP
      SELECT greatest(v_old.starts_on, max(signed_on)) INTO v_old_from FROM public.care_agreement_signatures WHERE agreement_id = v_old.id;
      v_old_until := least(v_old.ended_on, v_old.ends_on);
      CONTINUE WHEN v_old_until IS NOT NULL AND v_old_until < v_from;
      IF v_old_from >= v_from OR v_old.ended_on IS NOT NULL THEN
        RAISE EXCEPTION 'kin: a signed care agreement already covers the day this one begins' USING ERRCODE = 'KC005';
      END IF;
      UPDATE public.care_agreements SET ended_on = v_from - 1 WHERE circle_id = p_circle AND id = v_old.id;
      INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
        VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'care_agreement.replaced', 'care_agreement', v_old.id,
                jsonb_build_object('replacedBy', p_agreement, 'endedOn', v_from - 1), 'web');
    END LOOP;
  END
  $$;

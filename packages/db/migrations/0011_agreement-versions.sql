-- Versions of the family agreement, proposed and accepted in the app
-- (docs/architecture.md section 6 and decision 57).
--
-- A version governs from its start date once every member holding a share
-- in it has accepted it; the newest such version is the one in force. This
-- mirrors agreementStanding in packages/domain, which the screens use; a
-- test compares the two. Versions are never changed, so nothing marks one
-- as accepted: the acceptances say so.
CREATE FUNCTION kin_private.agreement_in_force(p_circle uuid) RETURNS SETOF public.agreements
  LANGUAGE sql STABLE SET search_path = pg_catalog, public
  AS $$
    SELECT a.* FROM public.agreements a
    JOIN public.circles c ON c.id = a.circle_id
    WHERE a.circle_id = p_circle
      AND a.effective_on <= (coalesce(c.clock_at, now()) AT TIME ZONE c.timezone)::date
      AND NOT EXISTS (
        SELECT 1 FROM public.agreement_shares s
        WHERE s.agreement_id = a.id
          AND NOT EXISTS (SELECT 1 FROM public.agreement_acceptances x WHERE x.agreement_id = a.id AND x.member_id = s.member_id)
      )
    ORDER BY a.version DESC
    LIMIT 1
  $$;
--> statement-breakpoint

-- A caregiver's payout is planned against the agreement in force, never a
-- proposal that the family has not accepted.
CREATE OR REPLACE FUNCTION kin_private.send_caregiver_bill(p_circle uuid, p_bill uuid, p_plan jsonb) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_circle public.circles;
    v_bill public.bills;
    v_payee public.payees;
    v_agreement public.agreements;
    v_now timestamptz;
    v_expires timestamptz;
    v_parent_decides boolean;
    v_first jsonb;
    v_slots jsonb;
    v_proposal uuid;
  BEGIN
    IF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor') THEN
      RAISE EXCEPTION 'kin: caregiver bill review refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    SELECT * INTO v_bill FROM public.bills WHERE circle_id = p_circle AND id = p_bill AND caregiver_details IS NOT NULL FOR UPDATE;
    IF NOT FOUND OR v_circle.id IS NULL THEN
      RAISE EXCEPTION 'kin: caregiver bill review refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_bill.state = 'proposed' THEN
      SELECT id INTO v_proposal FROM public.proposals WHERE circle_id = p_circle AND bill_id = p_bill ORDER BY raised_at DESC, id LIMIT 1;
      RETURN v_proposal;
    END IF;
    IF v_bill.state <> 'received' THEN
      RAISE EXCEPTION 'kin: caregiver bill is not waiting for review' USING ERRCODE = 'KB005';
    END IF;
    SELECT p.* INTO v_payee FROM public.payees p JOIN public.members m ON m.circle_id = p.circle_id AND m.id = p.member_id
      WHERE p.circle_id = p_circle AND p.id = v_bill.payee_id AND m.role = 'caregiver' AND m.status = 'active' FOR UPDATE OF p;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: caregiver bill review refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_agreement FROM kin_private.agreement_in_force(p_circle);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: the circle has no agreement to approve with' USING ERRCODE = 'KB008';
    END IF;
    v_now := coalesce(v_circle.clock_at, now());
    IF v_circle.paused_until IS NOT NULL AND v_circle.paused_until > v_now THEN
      RAISE EXCEPTION 'kin: the circle is paused' USING ERRCODE = 'KB007';
    END IF;
    IF v_bill.amount_cents > v_agreement.ceiling_cents THEN
      RAISE EXCEPTION 'kin: the bill is above the agreement''s ceiling' USING ERRCODE = 'KB006';
    END IF;

    v_parent_decides := EXISTS (
      SELECT 1 FROM public.members WHERE circle_id = p_circle AND role = 'parent' AND status = 'active' AND parent_level = 'decides'
    ) AND v_bill.amount_cents > v_agreement.parent_decides_above_cents;
    v_first := CASE WHEN v_parent_decides
      THEN '{"reason": "parent_decides", "roles": ["parent"]}'::jsonb
      ELSE '{"reason": "organizer", "roles": ["organizer"]}'::jsonb END;
    v_slots := CASE WHEN v_bill.amount_cents > v_agreement.second_approval_above_cents
      THEN jsonb_build_array(v_first, '{"reason": "second_approval", "roles": ["organizer", "contributor"]}'::jsonb)
      ELSE jsonb_build_array(v_first) END;
    BEGIN
      v_expires := (p_plan ->> 'expiresAt')::timestamptz;
    EXCEPTION WHEN others THEN
      v_expires := NULL;
    END;
    IF jsonb_typeof(p_plan) IS DISTINCT FROM 'object'
       OR p_plan - ARRAY['outcome', 'slots', 'payeeMemberId', 'announceToCircle', 'expiresAt'] <> '{}'::jsonb
       OR p_plan ->> 'outcome' IS DISTINCT FROM 'needs_approval'
       OR p_plan -> 'slots' IS DISTINCT FROM v_slots
       OR p_plan ->> 'payeeMemberId' IS DISTINCT FROM v_payee.member_id::text
       OR p_plan -> 'announceToCircle' IS DISTINCT FROM to_jsonb(v_payee.status = 'new')
       OR v_expires IS NULL
       OR v_expires NOT BETWEEN v_now + interval '71 hours 55 minutes' AND v_now + interval '72 hours 5 minutes' THEN
      RAISE EXCEPTION 'kin: the approval plan does not match the agreement' USING ERRCODE = 'check_violation';
    END IF;

    v_proposal := gen_random_uuid();
    INSERT INTO public.proposals (id, circle_id, kind, cents, payee_id, purpose, raised_by, raised_at, state, expires_at, agreement_version, plan, bill_id)
      VALUES (v_proposal, p_circle, 'caregiver_payout', v_bill.amount_cents, v_payee.id, 'caregiver_bill', kin_private.my_member_id(p_circle),
              v_now, 'pending_approval', v_expires, v_agreement.version, p_plan, p_bill);
    UPDATE public.bills SET state = 'ready' WHERE id = p_bill AND circle_id = p_circle;
    UPDATE public.bills SET state = 'proposed' WHERE id = p_bill AND circle_id = p_circle;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', kin_private.my_member_id(p_circle), 'caregiver_bill.sent', 'bill', p_bill,
              jsonb_build_object('proposalId', v_proposal), 'web');
    RETURN v_proposal;
  END
  $$;

--> statement-breakpoint

-- An organizer proposes a version. Every term is checked again here, as in
-- checkAgreementTerms: shares from active organizers and contributors, whole
-- basis points totalling 10 000 (also checked at commit), a ceiling above
-- zero with both thresholds at or below it, a care rate when care counts, and
-- a start no earlier than the circle's today. The proposer accepts it by
-- proposing it. The circle row is locked, so versions are numbered in turn.
CREATE FUNCTION kin_private.propose_agreement(
  p_circle uuid, p_effective_on date, p_care_rate bigint, p_care_cash boolean,
  p_ceiling bigint, p_second bigint, p_parent bigint, p_shares jsonb
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_circle public.circles;
    v_me uuid;
    v_now timestamptz;
    v_version integer;
    v_id uuid := gen_random_uuid();
    v_share jsonb;
    v_position integer := 0;
    v_total bigint := 0;
  BEGIN
    IF NOT coalesce(kin_private.is_organizer(p_circle), false) THEN
      RAISE EXCEPTION 'kin: agreement proposal refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active' FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: agreement proposal refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_me := kin_private.my_member_id(p_circle);
    v_now := coalesce(v_circle.clock_at, now());
    IF p_effective_on IS NULL OR p_effective_on < (v_now AT TIME ZONE v_circle.timezone)::date
       OR p_ceiling IS NULL OR p_ceiling <= 0 OR p_ceiling > 9007199254740991
       OR p_second IS NULL OR p_second < 0 OR p_second > p_ceiling
       OR p_parent IS NULL OR p_parent < 0 OR p_parent > p_ceiling
       OR (p_care_rate IS NOT NULL AND (p_care_rate <= 0 OR p_care_rate > 9007199254740991))
       OR p_care_cash IS NULL OR (p_care_cash AND p_care_rate IS NULL)
       OR jsonb_typeof(p_shares) IS DISTINCT FROM 'array' OR jsonb_array_length(p_shares) = 0 THEN
      RAISE EXCEPTION 'kin: invalid agreement terms' USING ERRCODE = 'check_violation';
    END IF;
    FOR v_share IN SELECT value FROM jsonb_array_elements(p_shares) LOOP
      IF jsonb_typeof(v_share) IS DISTINCT FROM 'object' OR v_share - ARRAY['memberId', 'bps'] <> '{}'::jsonb
         OR jsonb_typeof(v_share -> 'bps') IS DISTINCT FROM 'number' OR (v_share ->> 'bps') !~ '^[0-9]{1,5}$'
         OR (v_share ->> 'bps')::integer NOT BETWEEN 1 AND 10000
         OR (v_share ->> 'memberId') !~ '^[0-9a-f-]{36}$'
         OR NOT EXISTS (
           SELECT 1 FROM public.members WHERE circle_id = p_circle AND id = (v_share ->> 'memberId')::uuid
             AND status = 'active' AND role IN ('organizer', 'contributor')
         ) THEN
        RAISE EXCEPTION 'kin: invalid agreement share' USING ERRCODE = 'check_violation';
      END IF;
      v_total := v_total + (v_share ->> 'bps')::integer;
    END LOOP;
    IF v_total <> 10000 OR (SELECT count(DISTINCT value ->> 'memberId') FROM jsonb_array_elements(p_shares)) <> jsonb_array_length(p_shares) THEN
      RAISE EXCEPTION 'kin: invalid agreement shares' USING ERRCODE = 'check_violation';
    END IF;

    SELECT coalesce(max(version), 0) + 1 INTO v_version FROM public.agreements WHERE circle_id = p_circle;
    INSERT INTO public.agreements (id, circle_id, version, care_rate_cents_per_hour, care_paid_in_cash, ceiling_cents, second_approval_above_cents, parent_decides_above_cents, effective_on)
      VALUES (v_id, p_circle, v_version, p_care_rate, p_care_cash, p_ceiling, p_second, p_parent, p_effective_on);
    FOR v_share IN SELECT value FROM jsonb_array_elements(p_shares) LOOP
      INSERT INTO public.agreement_shares (id, circle_id, agreement_id, member_id, bps, position)
        VALUES (gen_random_uuid(), p_circle, v_id, (v_share ->> 'memberId')::uuid, (v_share ->> 'bps')::integer, v_position);
      v_position := v_position + 1;
    END LOOP;
    INSERT INTO public.agreement_acceptances (id, circle_id, agreement_id, member_id, method, accepted_at)
      VALUES (gen_random_uuid(), p_circle, v_id, v_me, 'app', v_now);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'agreement.proposed', 'agreement', v_id, jsonb_build_object('version', v_version), 'web');
    RETURN v_id;
  END
  $$;
--> statement-breakpoint

-- A member who shares the cost, or the parent, accepts the newest version.
-- An older proposal that a newer one replaced cannot be accepted any more.
-- Accepting twice changes nothing.
CREATE FUNCTION kin_private.accept_agreement(p_circle uuid, p_agreement uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_circle public.circles;
    v_me uuid;
    v_version integer;
  BEGIN
    IF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor', 'parent') THEN
      RAISE EXCEPTION 'kin: agreement acceptance refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active' FOR UPDATE;
    SELECT version INTO v_version FROM public.agreements WHERE circle_id = p_circle AND id = p_agreement;
    IF v_circle.id IS NULL OR v_version IS NULL THEN
      RAISE EXCEPTION 'kin: agreement acceptance refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_version <> (SELECT max(version) FROM public.agreements WHERE circle_id = p_circle) THEN
      RAISE EXCEPTION 'kin: a newer version of the agreement replaced this one' USING ERRCODE = 'KB011';
    END IF;
    v_me := kin_private.my_member_id(p_circle);
    IF EXISTS (SELECT 1 FROM public.agreement_acceptances WHERE agreement_id = p_agreement AND member_id = v_me) THEN
      RETURN;
    END IF;
    INSERT INTO public.agreement_acceptances (id, circle_id, agreement_id, member_id, method, accepted_at)
      VALUES (gen_random_uuid(), p_circle, p_agreement, v_me, 'app', coalesce(v_circle.clock_at, now()));
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'agreement.accepted', 'agreement', p_agreement, jsonb_build_object('version', v_version), 'web');
  END
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.agreement_in_force(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.propose_agreement(uuid, date, bigint, boolean, bigint, bigint, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.accept_agreement(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.agreement_in_force(uuid) TO kin_app, kin_service;
GRANT EXECUTE ON FUNCTION kin_private.propose_agreement(uuid, date, bigint, boolean, bigint, bigint, bigint, jsonb) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.accept_agreement(uuid, uuid) TO kin_app;

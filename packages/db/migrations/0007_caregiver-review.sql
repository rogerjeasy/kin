-- The family's review of a caregiver's bill, and answers to real money with a
-- fresh multi-factor check (docs/architecture.md sections 7.4, 7.5 and 12.1).
--
-- A structured caregiver bill has nothing to extract: the members who share
-- the cost send it for approval or decline it as received.
INSERT INTO kin_private.state_transitions (machine, from_state, to_state) VALUES
  ('bill', 'received', 'ready'),
  ('bill', 'received', 'rejected');
--> statement-breakpoint

-- Sending a bill raises its caregiver_payout proposal, in one transaction. The
-- web app plans the approvals with packages/domain; this function refuses a
-- plan that asks for fewer or other answers than the agreement in force, as
-- an integrity assertion like the caregiver bill's total in 0006. A retry
-- returns the proposal already raised.
CREATE FUNCTION kin_private.send_caregiver_bill(p_circle uuid, p_bill uuid, p_plan jsonb) RETURNS uuid
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
    SELECT * INTO v_agreement FROM public.agreements WHERE circle_id = p_circle ORDER BY version DESC LIMIT 1;
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

-- Declining a bill closes it and frees its service days for a corrected bill.
CREATE FUNCTION kin_private.decline_caregiver_bill(p_circle uuid, p_bill uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_state public.bill_state;
  BEGIN
    IF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor') THEN
      RAISE EXCEPTION 'kin: caregiver bill review refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT state INTO v_state FROM public.bills WHERE circle_id = p_circle AND id = p_bill AND caregiver_details IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: caregiver bill review refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_state = 'rejected' THEN
      RETURN;
    END IF;
    IF v_state <> 'received' THEN
      RAISE EXCEPTION 'kin: caregiver bill is not waiting for review' USING ERRCODE = 'KB005';
    END IF;
    UPDATE public.bills SET state = 'rejected' WHERE id = p_bill AND circle_id = p_circle;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', kin_private.my_member_id(p_circle), 'caregiver_bill.declined', 'bill', p_bill, 'web');
  END
  $$;
--> statement-breakpoint

-- A person now answers real money too. A no stops money, so it needs nothing
-- more. A yes in a real circle carries the evidence of the fresh multi-factor
-- check that the web app verified from Cognito's token (packages/auth
-- assessStepUp). The database cannot read the token, so it insists that the
-- evidence is recorded; the web app is where it is verified.
DROP POLICY app_answer ON public.approvals;
CREATE POLICY app_answer ON public.approvals FOR INSERT TO kin_app
  WITH CHECK (
    kin_private.answers_proposals(circle_id)
    AND member_id = kin_private.my_member_id(circle_id)
    AND role = kin_private.my_role(circle_id)
    AND (
      decision = 'reject'
      OR EXISTS (SELECT 1 FROM public.circles c WHERE c.id = approvals.circle_id AND c.demo)
      OR (method = 'app' AND evidence_ref ~ '^cognito:[^:]+:[0-9]+:')
    )
    AND EXISTS (SELECT 1 FROM public.proposals p WHERE p.id = proposal_id AND p.circle_id = approvals.circle_id AND p.state = 'pending_approval')
  );
--> statement-breakpoint

CREATE OR REPLACE FUNCTION kin_private.assert_person_decision() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_now timestamptz;
    v_demo boolean;
    v_slots integer;
    v_payee text := NEW.plan ->> 'payeeMemberId';
  BEGIN
    -- Kin's own service runs the executions; this guards what a person may
    -- do. The function runs as its owner, so it asks who connected.
    IF session_user <> 'kin_app' THEN
      RETURN NEW;
    END IF;
    SELECT c.demo, coalesce(c.clock_at, now()) INTO v_demo, v_now FROM public.circles c WHERE c.id = NEW.circle_id;
    IF NOT (OLD.state = 'pending_approval' AND NEW.state IN ('approved', 'rejected', 'expired')) THEN
      RAISE EXCEPTION 'kin: a person cannot move a proposal from % to %', OLD.state, NEW.state
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NEW.state = 'approved' THEN
      -- The plan stored when the proposal was raised says how many places
      -- need a yes. Each must be a different member, nobody may have said no,
      -- and the member being paid may not be the only one to say yes.
      IF NEW.plan ->> 'outcome' IS DISTINCT FROM 'needs_approval' THEN
        RAISE EXCEPTION 'kin: proposal % has no plan that waits for approval', NEW.id USING ERRCODE = 'check_violation';
      END IF;
      v_slots := jsonb_array_length(NEW.plan -> 'slots');
      IF EXISTS (SELECT 1 FROM public.approvals a WHERE a.proposal_id = NEW.id AND a.decision = 'reject') THEN
        RAISE EXCEPTION 'kin: proposal % has a no, so it cannot be approved', NEW.id USING ERRCODE = 'check_violation';
      END IF;
      IF (SELECT count(DISTINCT a.member_id) FROM public.approvals a WHERE a.proposal_id = NEW.id AND a.decision = 'approve') < v_slots THEN
        RAISE EXCEPTION 'kin: proposal % needs % yeses', NEW.id, v_slots USING ERRCODE = 'check_violation';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.approvals a
        WHERE a.proposal_id = NEW.id AND a.decision = 'approve' AND a.member_id::text IS DISTINCT FROM v_payee
      ) THEN
        RAISE EXCEPTION 'kin: the member being paid cannot be the only one to approve proposal %', NEW.id
          USING ERRCODE = 'check_violation';
      END IF;
      IF NOT v_demo AND EXISTS (
        SELECT 1 FROM public.approvals a
        WHERE a.proposal_id = NEW.id AND a.decision = 'approve' AND coalesce(a.evidence_ref, '') !~ '^cognito:[^:]+:[0-9]+:'
      ) THEN
        RAISE EXCEPTION 'kin: approving real money needs a fresh multi-factor check' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;

    IF NEW.state = 'rejected' AND NOT EXISTS (
      SELECT 1 FROM public.approvals a WHERE a.proposal_id = NEW.id AND a.decision = 'reject'
    ) THEN
      RAISE EXCEPTION 'kin: proposal % has no no to be rejected with', NEW.id USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.state = 'expired' AND (NEW.expires_at IS NULL OR NEW.expires_at > v_now) THEN
      RAISE EXCEPTION 'kin: proposal % has not expired yet', NEW.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.send_caregiver_bill(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.decline_caregiver_bill(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.send_caregiver_bill(uuid, uuid, jsonb) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.decline_caregiver_bill(uuid, uuid) TO kin_app;

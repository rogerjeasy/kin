-- Closes what 0003 left to the web app alone: the database now refuses a
-- person's decision that the stored approval plan does not support, even
-- from a query that never went through the approval engine.
--
-- A person may answer and decide only in a demo circle. Answering real money
-- needs a fresh multi-factor check (AGENTS.md section 6), which arrives with
-- payments; until then no person's answer or decision is accepted there.

DROP POLICY app_answer ON public.approvals;
CREATE POLICY app_answer ON public.approvals FOR INSERT TO kin_app
  WITH CHECK (
    kin_private.answers_proposals(circle_id)
    AND member_id = kin_private.my_member_id(circle_id)
    AND role = kin_private.my_role(circle_id)
    AND EXISTS (SELECT 1 FROM public.circles c WHERE c.id = approvals.circle_id AND c.demo)
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
    IF NOT v_demo THEN
      RAISE EXCEPTION 'kin: deciding a real payment needs a fresh multi-factor check' USING ERRCODE = 'insufficient_privilege';
    END IF;
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

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA kin_private FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA kin_private TO kin_app, kin_service, kin_provisioner;

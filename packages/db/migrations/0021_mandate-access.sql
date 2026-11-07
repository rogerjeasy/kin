-- Spoken mandates: the parent's standing permission (docs/feature-proposals.md
-- section 1). Tables mandates and mandate_uses come from the generated
-- migration before this one; this file adds their access rules, the
-- operations to grant, pause, resume and revoke a mandate, and lets a refill
-- that fits a live mandate be approved with the mandate recorded as the
-- approver. The fit is decided by packages/domain; the database asserts it
-- again so no query can skip it.
ALTER TABLE public.mandates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mandate_uses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Like every circle table: the service acts for the circle it names, and the
-- provisioner fills the circle it is creating. A person reads the circle's
-- mandates unless they are a caregiver, who sees none of the family's money.
CREATE POLICY service_own_circle ON public.mandates FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY service_own_circle ON public.mandate_uses FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY provisioner_new_circle ON public.mandates FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
CREATE POLICY provisioner_new_circle ON public.mandate_uses FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
CREATE POLICY app_member_read ON public.mandates FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));
CREATE POLICY app_member_read ON public.mandate_uses FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));
--> statement-breakpoint

-- Only the operations below write a mandate. The worker reads them.
GRANT SELECT ON public.mandates, public.mandate_uses TO kin_app, kin_service;
GRANT INSERT ON public.mandates, public.mandate_uses TO kin_provisioner;
--> statement-breakpoint

-- What was granted is what is checked: only the status moves, and a revoked
-- mandate never comes back.
CREATE FUNCTION kin_private.assert_mandate_terms_fixed() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF (to_jsonb(NEW) - 'status' - 'ended_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'ended_at') THEN
      RAISE EXCEPTION 'kin: mandate % cannot change after it is granted, only pause, resume or end', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'revoked' OR NEW.status = OLD.status THEN
      RAISE EXCEPTION 'kin: mandate % cannot move from % to %', OLD.id, OLD.status, NEW.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER terms_fixed BEFORE UPDATE ON public.mandates
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_mandate_terms_fixed();
--> statement-breakpoint

-- Recording the parent's permission. The parent grants in their own name; in a
-- demo circle the organizer plays the parent's spoken yes, and the row says
-- simulated. In a real circle only the parent can grant. The terms may not
-- exceed the agreement's ceiling, and the database seals them with a digest.
-- A retry with the same ID returns the mandate already granted.
CREATE FUNCTION kin_private.grant_mandate(
  p_circle uuid, p_id uuid, p_rule uuid, p_per_purchase bigint, p_per_period bigint, p_cadence text,
  p_valid_from date, p_expires_on date, p_spoken text
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_member uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_rule public.purchase_rules;
    v_agreement public.agreements;
    v_existing public.mandates;
    v_parent uuid;
    v_now timestamptz;
  BEGIN
    IF v_role IS NULL OR v_role NOT IN ('parent', 'organizer') THEN
      RAISE EXCEPTION 'kin: granting a mandate refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    SELECT * INTO v_rule FROM public.purchase_rules WHERE circle_id = p_circle AND id = p_rule;
    IF v_circle.id IS NULL OR v_rule.id IS NULL THEN
      RAISE EXCEPTION 'kin: granting a mandate refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_role = 'organizer' AND NOT v_circle.demo THEN
      RAISE EXCEPTION 'kin: only the parent grants a mandate' USING ERRCODE = 'KM001';
    END IF;
    SELECT * INTO v_existing FROM public.mandates WHERE circle_id = p_circle AND id = p_id;
    IF FOUND THEN
      IF v_existing.rule_id = p_rule AND v_existing.per_purchase_cents = p_per_purchase AND v_existing.per_period_cents = p_per_period
         AND v_existing.cadence = p_cadence AND v_existing.valid_from = p_valid_from AND v_existing.expires_on = p_expires_on THEN
        RETURN p_id;
      END IF;
      RAISE EXCEPTION 'kin: mandate key reused' USING ERRCODE = 'KB004';
    END IF;
    v_parent := CASE WHEN v_role = 'parent' THEN v_member
      ELSE (SELECT m.id FROM public.members m WHERE m.circle_id = p_circle AND m.role = 'parent' AND m.status = 'active' ORDER BY m.joined_at, m.id LIMIT 1) END;
    IF v_parent IS NULL THEN
      RAISE EXCEPTION 'kin: the circle has no parent to grant a mandate' USING ERRCODE = 'KM002';
    END IF;
    SELECT * INTO v_agreement FROM kin_private.agreement_in_force(p_circle);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: the circle has no agreement to bound a mandate' USING ERRCODE = 'KB008';
    END IF;
    IF p_per_purchase > v_agreement.ceiling_cents THEN
      RAISE EXCEPTION 'kin: a mandate cannot exceed the agreement''s ceiling' USING ERRCODE = 'KB006';
    END IF;
    v_now := coalesce(v_circle.clock_at, now());
    IF p_expires_on < (v_now AT TIME ZONE v_circle.timezone)::date THEN
      RAISE EXCEPTION 'kin: a mandate cannot be granted already expired' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.mandates (id, circle_id, rule_id, granted_by, recorded_by, per_purchase_cents, per_period_cents, cadence,
                                 valid_from, expires_on, status, spoken_text, evidence_ref, simulated, digest, granted_at)
      VALUES (p_id, p_circle, p_rule, v_parent, v_member, p_per_purchase, p_per_period, p_cadence, p_valid_from, p_expires_on, 'active',
              nullif(trim(p_spoken), ''),
              CASE WHEN v_role = 'parent' THEN 'parent-confirmed:' || p_id::text ELSE 'demo-voice:' || p_id::text END,
              v_circle.demo,
              encode(sha256(convert_to(jsonb_build_array(p_rule::text, p_per_purchase, p_per_period, p_cadence, p_valid_from::text, p_expires_on::text)::text, 'UTF8')), 'hex'),
              v_now);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_member, 'mandate.granted', 'mandate', p_id,
              jsonb_build_object('ruleId', p_rule, 'perPurchaseCents', p_per_purchase, 'perPeriodCents', p_per_period, 'simulated', v_circle.demo), 'web');
    RETURN p_id;
  END
  $$;
--> statement-breakpoint

-- Pausing holds a mandate still and any member who answers may do it, since
-- stopping is always safe. Resuming or ending it is the parent's call (or, in
-- a demo circle, the organizer playing the parent).
CREATE FUNCTION kin_private.set_mandate_status(p_circle uuid, p_mandate uuid, p_status public.mandate_status) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_demo boolean;
    v_now timestamptz;
  BEGIN
    SELECT c.demo, coalesce(c.clock_at, now()) INTO v_demo, v_now FROM public.circles c WHERE c.id = p_circle AND c.status = 'active';
    IF v_role IS NULL OR v_demo IS NULL OR v_role NOT IN ('organizer', 'contributor', 'parent')
       OR (p_status <> 'paused' AND NOT (v_role = 'parent' OR (v_role = 'organizer' AND v_demo))) THEN
      RAISE EXCEPTION 'kin: changing a mandate refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM 1 FROM public.mandates WHERE circle_id = p_circle AND id = p_mandate FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: changing a mandate refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE public.mandates SET status = p_status, ended_at = CASE WHEN p_status = 'revoked' THEN v_now ELSE NULL END
      WHERE circle_id = p_circle AND id = p_mandate;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', kin_private.my_member_id(p_circle), 'mandate.' || p_status::text, 'mandate', p_mandate, '{}'::jsonb, 'web');
  END
  $$;
--> statement-breakpoint

-- A person may not label their own answer as a mandate's: only the operation
-- below records a mandate as the approver.
DROP POLICY app_answer ON public.approvals;
CREATE POLICY app_answer ON public.approvals FOR INSERT TO kin_app
  WITH CHECK (
    kin_private.answers_proposals(circle_id)
    AND member_id = kin_private.my_member_id(circle_id)
    AND role = kin_private.my_role(circle_id)
    -- Compared as text: PostgreSQL refuses to use an enum value in the transaction that added it, and a deploy runs every pending migration in one.
    AND method::text <> 'mandate'
    AND (
      decision = 'reject'
      OR EXISTS (SELECT 1 FROM public.circles c WHERE c.id = approvals.circle_id AND c.demo)
      OR (method = 'app' AND evidence_ref ~ '^cognito:[^:]+:[0-9]+:')
    )
    AND EXISTS (SELECT 1 FROM public.proposals p WHERE p.id = proposal_id AND p.circle_id = approvals.circle_id AND p.state = 'pending_approval')
  );
--> statement-breakpoint

-- A refill approved by a mandate carries a plan of outcome "mandate" and the
-- approval the mandate itself recorded, with a use of the mandate; nothing
-- else may approve it. Every other plan is checked as before.
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

    IF NEW.state = 'approved' AND NEW.plan ->> 'outcome' = 'mandate' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.approvals a JOIN public.mandates m ON m.circle_id = a.circle_id AND m.granted_by = a.member_id
        WHERE a.proposal_id = NEW.id AND a.decision = 'approve' AND a.method = 'mandate' AND a.evidence_ref = 'mandate:' || m.id::text
          AND m.id::text = NEW.plan ->> 'mandateId'
      ) OR NOT EXISTS (
        SELECT 1 FROM public.mandate_uses u WHERE u.proposal_id = NEW.id AND u.mandate_id::text = NEW.plan ->> 'mandateId'
      ) OR EXISTS (SELECT 1 FROM public.approvals a WHERE a.proposal_id = NEW.id AND a.decision = 'reject') THEN
        RAISE EXCEPTION 'kin: proposal % is not covered by a mandate', NEW.id USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.state = 'approved' THEN
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

-- Raising a refill (0016), now also under a mandate. With a plan that needs
-- approval it behaves exactly as before. With a plan of outcome "mandate" the
-- named mandate must be live and the refill must fit it (scope, validity,
-- limit for each purchase, budget for the period, cadence); then the proposal
-- is approved in the same transaction with the mandate recorded as the
-- approver, which queues the purchase through the ordinary path (0016).
CREATE OR REPLACE FUNCTION kin_private.propose_refill(p_circle uuid, p_rule uuid, p_plan jsonb) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_circle public.circles;
    v_rule public.purchase_rules;
    v_payee public.payees;
    v_agreement public.agreements;
    v_mandate public.mandates;
    v_now timestamptz;
    v_month text;
    v_committed bigint;
    v_used bigint;
    v_uses bigint;
    v_expires timestamptz;
    v_parent_decides boolean;
    v_first jsonb;
    v_slots jsonb;
    v_proposal uuid;
    v_by_mandate boolean := jsonb_typeof(p_plan) = 'object' AND p_plan ->> 'outcome' = 'mandate';
  BEGIN
    IF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor', 'parent') THEN
      RAISE EXCEPTION 'kin: refill refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    SELECT * INTO v_rule FROM public.purchase_rules WHERE circle_id = p_circle AND id = p_rule FOR UPDATE;
    IF v_circle.id IS NULL OR v_rule.id IS NULL THEN
      RAISE EXCEPTION 'kin: refill refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT v_circle.demo THEN
      RAISE EXCEPTION 'kin: refills are bought in demo circles only' USING ERRCODE = 'KB010';
    END IF;
    SELECT p.id INTO v_proposal FROM public.proposals p JOIN public.purchases u ON u.circle_id = p.circle_id AND u.proposal_id = p.id
      WHERE p.circle_id = p_circle AND u.rule_id = p_rule AND p.state IN ('pending_approval', 'approved', 'executing')
      ORDER BY p.raised_at DESC, p.id LIMIT 1;
    IF FOUND THEN
      RETURN v_proposal;
    END IF;
    SELECT * INTO v_payee FROM public.payees WHERE circle_id = p_circle AND id = v_rule.payee_id;
    IF NOT FOUND OR v_payee.status <> 'approved' THEN
      RAISE EXCEPTION 'kin: the seller is not approved' USING ERRCODE = 'KB013';
    END IF;
    SELECT * INTO v_agreement FROM kin_private.agreement_in_force(p_circle);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: the circle has no agreement to approve with' USING ERRCODE = 'KB008';
    END IF;
    v_now := coalesce(v_circle.clock_at, now());
    IF v_circle.paused_until IS NOT NULL AND v_circle.paused_until > v_now THEN
      RAISE EXCEPTION 'kin: the circle is paused' USING ERRCODE = 'KB007';
    END IF;
    IF v_rule.price_cents > v_rule.limit_cents THEN
      RAISE EXCEPTION 'kin: the price is above the rule''s limit' USING ERRCODE = 'KB011';
    END IF;
    IF v_rule.price_cents > v_agreement.ceiling_cents THEN
      RAISE EXCEPTION 'kin: the refill is above the agreement''s ceiling' USING ERRCODE = 'KB006';
    END IF;
    v_month := to_char(v_now AT TIME ZONE v_circle.timezone, 'YYYY-MM');
    SELECT coalesce(sum(u.cents), 0) INTO v_committed
      FROM public.purchases u JOIN public.proposals p ON p.circle_id = u.circle_id AND p.id = u.proposal_id
      WHERE u.circle_id = p_circle AND u.rule_id = p_rule
        AND p.state IN ('pending_approval', 'approved', 'executing', 'settled')
        AND to_char(p.raised_at AT TIME ZONE v_circle.timezone, 'YYYY-MM') = v_month;
    IF v_committed + v_rule.price_cents > v_rule.monthly_budget_cents THEN
      RAISE EXCEPTION 'kin: the refill is over the rule''s budget for the month' USING ERRCODE = 'KB012';
    END IF;

    IF v_by_mandate THEN
      BEGIN
        SELECT * INTO v_mandate FROM public.mandates
          WHERE circle_id = p_circle AND id = (p_plan ->> 'mandateId')::uuid AND rule_id = p_rule FOR UPDATE;
      EXCEPTION WHEN others THEN
        v_mandate := NULL;
      END;
      IF jsonb_typeof(p_plan) IS DISTINCT FROM 'object'
         OR p_plan - ARRAY['outcome', 'mandateId', 'agreementVersion'] <> '{}'::jsonb
         OR p_plan -> 'agreementVersion' IS DISTINCT FROM to_jsonb(v_agreement.version)
         OR v_mandate.id IS NULL THEN
        RAISE EXCEPTION 'kin: the approval plan does not match the agreement' USING ERRCODE = 'check_violation';
      END IF;
      SELECT coalesce(sum(u.cents), 0), count(*) INTO v_used, v_uses
        FROM public.mandate_uses u JOIN public.proposals p ON p.circle_id = u.circle_id AND p.id = u.proposal_id
        WHERE u.circle_id = p_circle AND u.mandate_id = v_mandate.id AND u.period = v_month
          AND p.state IN ('pending_approval', 'approved', 'executing', 'settled');
      IF v_mandate.status <> 'active'
         OR (v_now AT TIME ZONE v_circle.timezone)::date NOT BETWEEN v_mandate.valid_from AND v_mandate.expires_on
         OR v_rule.price_cents > v_mandate.per_purchase_cents
         OR v_used + v_rule.price_cents > v_mandate.per_period_cents
         OR (v_mandate.cadence = 'monthly' AND v_uses > 0) THEN
        RAISE EXCEPTION 'kin: the refill does not fit the mandate' USING ERRCODE = 'KM010';
      END IF;
      v_proposal := gen_random_uuid();
      INSERT INTO public.proposals (id, circle_id, kind, cents, payee_id, purpose, raised_by, raised_at, state, expires_at, agreement_version, plan)
        VALUES (v_proposal, p_circle, 'purchase', v_rule.price_cents, v_rule.payee_id, 'refill', NULL,
                v_now, 'pending_approval', NULL, v_agreement.version, p_plan);
      INSERT INTO public.purchases (id, circle_id, rule_id, proposal_id, item, cents)
        VALUES (gen_random_uuid(), p_circle, p_rule, v_proposal, v_rule.item, v_rule.price_cents);
      INSERT INTO public.mandate_uses (id, circle_id, mandate_id, proposal_id, cents, period)
        VALUES (gen_random_uuid(), p_circle, v_mandate.id, v_proposal, v_rule.price_cents, v_month);
      INSERT INTO public.approvals (id, circle_id, proposal_id, member_id, role, decision, method, evidence_ref, decided_at)
        VALUES (gen_random_uuid(), p_circle, v_proposal, v_mandate.granted_by, 'parent', 'approve', 'mandate', 'mandate:' || v_mandate.id::text, v_now);
      UPDATE public.proposals SET state = 'approved' WHERE id = v_proposal;
      INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
        VALUES (gen_random_uuid(), p_circle, 'member', kin_private.my_member_id(p_circle), 'refill.proposed', 'proposal', v_proposal,
                jsonb_build_object('ruleId', p_rule, 'mandateId', v_mandate.id), 'web');
      RETURN v_proposal;
    END IF;

    v_parent_decides := EXISTS (
      SELECT 1 FROM public.members WHERE circle_id = p_circle AND role = 'parent' AND status = 'active' AND parent_level = 'decides'
    ) AND v_rule.price_cents > v_agreement.parent_decides_above_cents;
    v_first := CASE WHEN v_parent_decides
      THEN '{"reason": "parent_decides", "roles": ["parent"]}'::jsonb
      ELSE '{"reason": "organizer", "roles": ["organizer"]}'::jsonb END;
    v_slots := CASE WHEN v_rule.price_cents > v_agreement.second_approval_above_cents
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
       OR p_plan ->> 'payeeMemberId' IS NOT NULL
       OR p_plan -> 'announceToCircle' IS DISTINCT FROM 'false'::jsonb
       OR v_expires IS NULL
       OR v_expires NOT BETWEEN v_now + interval '71 hours 55 minutes' AND v_now + interval '72 hours 5 minutes' THEN
      RAISE EXCEPTION 'kin: the approval plan does not match the agreement' USING ERRCODE = 'check_violation';
    END IF;

    v_proposal := gen_random_uuid();
    INSERT INTO public.proposals (id, circle_id, kind, cents, payee_id, purpose, raised_by, raised_at, state, expires_at, agreement_version, plan)
      VALUES (v_proposal, p_circle, 'purchase', v_rule.price_cents, v_rule.payee_id, 'refill', NULL,
              v_now, 'pending_approval', v_expires, v_agreement.version, p_plan);
    INSERT INTO public.purchases (id, circle_id, rule_id, proposal_id, item, cents)
      VALUES (gen_random_uuid(), p_circle, p_rule, v_proposal, v_rule.item, v_rule.price_cents);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', kin_private.my_member_id(p_circle), 'refill.proposed', 'proposal', v_proposal,
              jsonb_build_object('ruleId', p_rule), 'web');
    RETURN v_proposal;
  END
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.assert_mandate_terms_fixed() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.grant_mandate(uuid, uuid, uuid, bigint, bigint, text, date, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.set_mandate_status(uuid, uuid, public.mandate_status) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.grant_mandate(uuid, uuid, uuid, bigint, bigint, text, date, date, text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.set_mandate_status(uuid, uuid, public.mandate_status) TO kin_app;

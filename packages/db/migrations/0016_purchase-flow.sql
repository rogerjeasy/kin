-- Refills Kin proposes for the parent and the family confirms
-- (docs/architecture.md sections 7.4, 8.6 and 9.3). Tables purchase_rules and
-- purchases come from the generated migration before this one; this file adds
-- their access rules, the delivery state machine and the operations around them.
ALTER TABLE public.purchase_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Like every circle table: the service acts for the circle it names, and the
-- provisioner fills the circle it is creating. A person reads the circle's
-- purchases unless they are a caregiver, who sees none of the family's money.
CREATE POLICY service_own_circle ON public.purchase_rules FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY service_own_circle ON public.purchases FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY provisioner_new_circle ON public.purchase_rules FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
CREATE POLICY provisioner_new_circle ON public.purchases FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
CREATE POLICY app_member_read ON public.purchase_rules FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));
CREATE POLICY app_member_read ON public.purchases FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));
--> statement-breakpoint

GRANT SELECT ON public.purchase_rules, public.purchases TO kin_app;
GRANT SELECT, INSERT, UPDATE ON public.purchase_rules, public.purchases TO kin_service;
GRANT INSERT ON public.purchase_rules, public.purchases TO kin_provisioner;
--> statement-breakpoint

-- The delivery state machine, checked against packages/domain by a test.
INSERT INTO kin_private.state_transitions (machine, from_state, to_state) VALUES
  ('delivery', 'awaiting', 'ordered'),
  ('delivery', 'ordered', 'shipped'),
  ('delivery', 'shipped', 'out_for_delivery'),
  ('delivery', 'out_for_delivery', 'delivered');

CREATE TRIGGER state_moves_forward BEFORE UPDATE OF state ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_transition('delivery');

-- What was approved is what is bought: only the delivery's progress changes.
CREATE FUNCTION kin_private.assert_purchase_terms_fixed() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF (to_jsonb(NEW) - 'state' - 'merchant_order' - 'ordered_at' - 'delivered_at')
       IS DISTINCT FROM (to_jsonb(OLD) - 'state' - 'merchant_order' - 'ordered_at' - 'delivered_at') THEN
      RAISE EXCEPTION 'kin: purchase % cannot change after it is raised, only move to the door', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER terms_fixed BEFORE UPDATE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_purchase_terms_fixed();

ALTER TABLE public.purchases ADD CONSTRAINT purchases_progress_recorded CHECK (
  (state = 'awaiting' OR (merchant_order IS NOT NULL AND ordered_at IS NOT NULL))
  AND (state <> 'delivered' OR delivered_at IS NOT NULL)
);
--> statement-breakpoint

-- Raising a refill. Kin proposes it from a rule the family set; a member asks
-- for it, and the approval plan, worked out by packages/domain, is checked
-- here as an integrity assertion against the agreement in force. Money never
-- moves from here: only the family's approval queues the purchase.
--
-- Refills are bought in demo circles only, with simulated money. A real
-- circle would charge a PayPal wallet saved for the seller, which no screen
-- sets up yet, so the operation refuses it rather than propose what Kin
-- cannot carry out. A retry returns the refill still waiting.
CREATE FUNCTION kin_private.propose_refill(p_circle uuid, p_rule uuid, p_plan jsonb) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_circle public.circles;
    v_rule public.purchase_rules;
    v_payee public.payees;
    v_agreement public.agreements;
    v_now timestamptz;
    v_month text;
    v_committed bigint;
    v_expires timestamptz;
    v_parent_decides boolean;
    v_first jsonb;
    v_slots jsonb;
    v_proposal uuid;
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

-- In the same transaction that a refill becomes approved, Kin creates its
-- execution and tells the worker to carry it out, as for a caregiver payout
-- (0008): an approval can never be lost between the database and the worker.
CREATE FUNCTION kin_private.queue_purchase() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_execution uuid := gen_random_uuid();
  BEGIN
    INSERT INTO public.executions (id, circle_id, proposal_id, idempotency_key, state)
      VALUES (v_execution, NEW.circle_id, NEW.id, 'kin-purchase-' || NEW.id::text, 'created');
    INSERT INTO public.outbox (id, circle_id, topic, payload)
      VALUES (gen_random_uuid(), NEW.circle_id, 'purchase.execute', jsonb_build_object('executionId', v_execution));
    RETURN NEW;
  END
  $$;

CREATE TRIGGER queue_purchase AFTER UPDATE OF state ON public.proposals
  FOR EACH ROW
  WHEN (OLD.state = 'pending_approval' AND NEW.state = 'approved' AND NEW.kind = 'purchase')
  EXECUTE FUNCTION kin_private.queue_purchase();
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.propose_refill(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.queue_purchase() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.assert_purchase_terms_fixed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.propose_refill(uuid, uuid, jsonb) TO kin_app;

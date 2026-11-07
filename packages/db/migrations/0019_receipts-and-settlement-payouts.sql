-- A member's receipts, and paying the month's settlement
-- (docs/architecture.md sections 7.3, 7.6 and 8.5).
--
-- Receipts: a member who spent their own money for the parent files a
-- receipt, another member approves it, and Kin's worker then credits it to
-- the ledger. Nobody but the worker writes the ledger, so these operations
-- only record the receipt and the decision, and queue the credit.
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY service_own_circle ON public.receipts FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id())
  WITH CHECK (circle_id = kin_private.circle_id());

-- Everyone who sees the circle's money reads its receipts. A member reads
-- their own either way.
CREATE POLICY app_member_read ON public.receipts FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id)
         OR (kin_private.is_member(circle_id) AND member_id = kin_private.my_member_id(circle_id)));

GRANT SELECT ON public.receipts TO kin_app;
GRANT SELECT, INSERT, UPDATE ON public.receipts TO kin_service;
--> statement-breakpoint

-- Files a receipt in the member's own name. The ID is chosen by the caller,
-- so a retried request files it once. The credit waits for another member.
CREATE FUNCTION kin_private.submit_receipt(
  p_circle uuid, p_id uuid, p_category text, p_cents bigint, p_description text, p_spent_on date
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_member uuid := kin_private.my_member_id(p_circle);
    v_existing public.receipts;
    v_today date;
  BEGIN
    IF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor') THEN
      RAISE EXCEPTION 'kin: receipt refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT (coalesce(c.clock_at, now()) AT TIME ZONE c.timezone)::date INTO v_today FROM public.circles c WHERE c.id = p_circle AND c.status = 'active';
    IF v_today IS NULL THEN
      RAISE EXCEPTION 'kin: receipt refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_existing FROM public.receipts WHERE circle_id = p_circle AND id = p_id;
    IF FOUND THEN
      -- The same request again returns the receipt; the same ID for anything else is refused.
      IF v_existing.member_id = v_member AND v_existing.category = p_category AND v_existing.cents = p_cents
         AND v_existing.description = trim(p_description) AND v_existing.spent_on = p_spent_on THEN
        RETURN p_id;
      END IF;
      RAISE EXCEPTION 'kin: receipt key reused' USING ERRCODE = 'KB004';
    END IF;
    IF p_spent_on > v_today THEN
      RAISE EXCEPTION 'kin: a receipt cannot be dated in the future' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.receipts (id, circle_id, member_id, category, cents, description, spent_on)
      VALUES (p_id, p_circle, v_member, p_category, p_cents, trim(p_description), p_spent_on);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_member, 'receipt.submitted', 'receipt', p_id,
              jsonb_build_object('cents', p_cents, 'category', p_category), 'web');
    RETURN p_id;
  END
  $$;
--> statement-breakpoint

-- Another member approves or rejects a receipt. Nobody decides their own, so
-- no member can credit themselves. An approval queues the credit for the
-- worker in the same transaction, so it cannot be lost between the two.
CREATE FUNCTION kin_private.decide_receipt(p_circle uuid, p_receipt uuid, p_approve boolean) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_member uuid := kin_private.my_member_id(p_circle);
    v_receipt public.receipts;
    v_target public.receipt_state := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
    v_at timestamptz;
  BEGIN
    IF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor') THEN
      RAISE EXCEPTION 'kin: receipt decision refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_receipt FROM public.receipts WHERE circle_id = p_circle AND id = p_receipt FOR UPDATE;
    IF NOT FOUND OR v_receipt.member_id = v_member THEN
      RAISE EXCEPTION 'kin: receipt decision refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_receipt.state = v_target OR (p_approve AND v_receipt.state = 'credited') THEN
      RETURN;
    END IF;
    IF v_receipt.state <> 'submitted' THEN
      RAISE EXCEPTION 'kin: receipt is not waiting for a decision' USING ERRCODE = 'KB005';
    END IF;
    SELECT coalesce(c.clock_at, now()) INTO v_at FROM public.circles c WHERE c.id = p_circle;
    UPDATE public.receipts SET state = v_target, decided_by = v_member, decided_at = v_at WHERE id = p_receipt AND circle_id = p_circle;
    IF p_approve THEN
      INSERT INTO public.outbox (id, circle_id, topic, payload)
        VALUES (gen_random_uuid(), p_circle, 'receipt.credit', jsonb_build_object('receiptId', p_receipt));
    END IF;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_member, CASE WHEN p_approve THEN 'receipt.approved' ELSE 'receipt.rejected' END, 'receipt', p_receipt,
              jsonb_build_object('cents', v_receipt.cents), 'web');
  END
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.submit_receipt(uuid, uuid, text, bigint, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.decide_receipt(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.submit_receipt(uuid, uuid, text, bigint, text, date) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.decide_receipt(uuid, uuid, boolean) TO kin_app;
--> statement-breakpoint

-- Settlement: one live settlement for each period. A second proposal for a
-- period that already has one is refused, whatever became of the first.
CREATE UNIQUE INDEX settlements_one_per_period ON public.settlements (circle_id, period) WHERE state <> 'superseded';
--> statement-breakpoint

-- Where a member's settlement payout goes, in their own words. It is a payee
-- row of its own category, so a caregiver's pay address and a sibling's never
-- mix. Like a caregiver's, it cannot change while a payout to the member waits
-- or is under way, so nobody can redirect money the family already approved.
CREATE FUNCTION kin_private.set_own_settlement_receiver(p_circle uuid, p_email text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_email text := lower(trim(coalesce(p_email, '')));
    v_member uuid := kin_private.my_member_id(p_circle);
    v_payee public.payees;
  BEGIN
    IF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor', 'parent') THEN
      RAISE EXCEPTION 'kin: settlement receiver refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF length(v_email) > 127 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
      RAISE EXCEPTION 'kin: invalid PayPal email' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_payee FROM public.payees WHERE circle_id = p_circle AND member_id = v_member AND category = 'settlement' FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.payees (id, circle_id, name, category, status, member_id, paypal_receiver)
        SELECT gen_random_uuid(), p_circle, m.display_name, 'settlement', 'approved', m.id, v_email
        FROM public.members m WHERE m.circle_id = p_circle AND m.id = v_member;
    ELSE
      IF v_payee.paypal_receiver IS NOT DISTINCT FROM v_email THEN
        RETURN;
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.proposals
        WHERE circle_id = p_circle AND member_id = v_member AND kind = 'member_payout'
          AND state IN ('proposed', 'pending_approval', 'approved', 'executing', 'failed')
      ) THEN
        RAISE EXCEPTION 'kin: a settlement payment to this member is in progress' USING ERRCODE = 'KB009';
      END IF;
      UPDATE public.payees SET paypal_receiver = v_email WHERE id = v_payee.id AND circle_id = p_circle;
    END IF;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_member, 'settlement_receiver.set', 'member', v_member, 'web');
  END
  $$;
--> statement-breakpoint

-- Puts a period's settlement to the family: the settlement as the money core
-- calculated it, and one member_payout proposal for each member the pool can
-- pay now. The web app plans the approvals with packages/domain; as with a
-- caregiver's bill, this function refuses a plan that asks for fewer or other
-- answers than the agreement in force, and it refuses payouts that together
-- exceed the cash the pool holds, so a bug in the plan cannot promise money
-- that has not arrived. A retry for the same period is refused, never doubled.
CREATE FUNCTION kin_private.propose_settlement(
  p_circle uuid, p_period text, p_agreement_version integer, p_inputs jsonb, p_fairness jsonb, p_plan jsonb, p_payouts jsonb
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_circle public.circles;
    v_agreement public.agreements;
    v_now timestamptz;
    v_parent_decides_role boolean;
    v_settlement uuid := gen_random_uuid();
    v_pool bigint;
    v_total bigint := 0;
    v_payout jsonb;
    v_member uuid;
    v_cents bigint;
    v_plan jsonb;
    v_slots jsonb;
    v_first jsonb;
    v_expires timestamptz;
    v_seen uuid[] := ARRAY[]::uuid[];
  BEGIN
    IF NOT coalesce(kin_private.is_organizer(p_circle), false) THEN
      RAISE EXCEPTION 'kin: settlement refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active' FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: settlement refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR jsonb_typeof(p_payouts) IS DISTINCT FROM 'array' OR jsonb_array_length(p_payouts) = 0 THEN
      RAISE EXCEPTION 'kin: invalid settlement' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.settlements WHERE circle_id = p_circle AND period = p_period AND state <> 'superseded') THEN
      RAISE EXCEPTION 'kin: the period already has a settlement' USING ERRCODE = 'KB010';
    END IF;
    SELECT * INTO v_agreement FROM public.agreements WHERE circle_id = p_circle ORDER BY version DESC LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: the circle has no agreement to approve with' USING ERRCODE = 'KB008';
    END IF;
    IF v_agreement.version <> p_agreement_version THEN
      RAISE EXCEPTION 'kin: the settlement was planned against another agreement' USING ERRCODE = 'check_violation';
    END IF;
    v_now := coalesce(v_circle.clock_at, now());
    IF v_circle.paused_until IS NOT NULL AND v_circle.paused_until > v_now THEN
      RAISE EXCEPTION 'kin: the circle is paused' USING ERRCODE = 'KB007';
    END IF;
    v_parent_decides_role := EXISTS (
      SELECT 1 FROM public.members WHERE circle_id = p_circle AND role = 'parent' AND status = 'active' AND parent_level = 'decides'
    );

    SELECT coalesce(sum(CASE l.direction WHEN 'debit' THEN l.cents ELSE -l.cents END), 0) INTO v_pool
      FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.circle_id = l.circle_id AND a.id = l.account_id
      WHERE l.circle_id = p_circle AND a.code = 'pool_cash';

    INSERT INTO public.settlements (id, circle_id, period, agreement_version, inputs, fairness, plan, state, calculated_at)
      VALUES (v_settlement, p_circle, p_period, v_agreement.version, p_inputs, p_fairness, p_plan, 'proposed', v_now);

    FOR v_payout IN SELECT * FROM jsonb_array_elements(p_payouts) LOOP
      IF jsonb_typeof(v_payout) IS DISTINCT FROM 'object' OR v_payout - ARRAY['memberId', 'cents', 'plan'] <> '{}'::jsonb THEN
        RAISE EXCEPTION 'kin: invalid settlement payout' USING ERRCODE = 'check_violation';
      END IF;
      v_member := (v_payout ->> 'memberId')::uuid;
      v_cents := (v_payout ->> 'cents')::bigint;
      v_plan := v_payout -> 'plan';
      IF v_cents IS NULL OR v_cents <= 0 OR v_member = ANY (v_seen) THEN
        RAISE EXCEPTION 'kin: invalid settlement payout' USING ERRCODE = 'check_violation';
      END IF;
      v_seen := v_seen || v_member;
      PERFORM 1 FROM public.members WHERE circle_id = p_circle AND id = v_member AND status = 'active' AND role IN ('organizer', 'contributor', 'parent');
      IF NOT FOUND THEN
        RAISE EXCEPTION 'kin: a settlement pays only a member who shares the cost' USING ERRCODE = 'check_violation';
      END IF;
      IF v_cents > v_agreement.ceiling_cents THEN
        RAISE EXCEPTION 'kin: the payout is above the agreement''s ceiling' USING ERRCODE = 'KB006';
      END IF;
      v_total := v_total + v_cents;

      v_first := CASE WHEN v_parent_decides_role AND v_cents > v_agreement.parent_decides_above_cents
        THEN '{"reason": "parent_decides", "roles": ["parent"]}'::jsonb
        ELSE '{"reason": "organizer", "roles": ["organizer"]}'::jsonb END;
      v_slots := CASE WHEN v_cents > v_agreement.second_approval_above_cents
        THEN jsonb_build_array(v_first, '{"reason": "second_approval", "roles": ["organizer", "contributor"]}'::jsonb)
        ELSE jsonb_build_array(v_first) END;
      BEGIN
        v_expires := (v_plan ->> 'expiresAt')::timestamptz;
      EXCEPTION WHEN others THEN
        v_expires := NULL;
      END;
      IF jsonb_typeof(v_plan) IS DISTINCT FROM 'object'
         OR v_plan - ARRAY['outcome', 'slots', 'payeeMemberId', 'announceToCircle', 'expiresAt'] <> '{}'::jsonb
         OR v_plan ->> 'outcome' IS DISTINCT FROM 'needs_approval'
         OR v_plan -> 'slots' IS DISTINCT FROM v_slots
         OR v_plan ->> 'payeeMemberId' IS DISTINCT FROM v_member::text
         OR v_plan -> 'announceToCircle' IS DISTINCT FROM 'false'::jsonb
         OR v_expires IS NULL
         OR v_expires NOT BETWEEN v_now + interval '71 hours 55 minutes' AND v_now + interval '72 hours 5 minutes' THEN
        RAISE EXCEPTION 'kin: the approval plan does not match the agreement' USING ERRCODE = 'check_violation';
      END IF;

      INSERT INTO public.proposals (id, circle_id, kind, cents, member_id, purpose, raised_by, raised_at, state, expires_at, agreement_version, plan, settlement_id)
        VALUES (gen_random_uuid(), p_circle, 'member_payout', v_cents, v_member, 'settlement', kin_private.my_member_id(p_circle),
                v_now, 'pending_approval', v_expires, v_agreement.version, v_plan, v_settlement);
    END LOOP;

    -- Never promise money that has not arrived.
    IF v_total > v_pool THEN
      RAISE EXCEPTION 'kin: the settlement pays more than the pool holds' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', kin_private.my_member_id(p_circle), 'settlement.proposed', 'settlement', v_settlement,
              jsonb_build_object('period', p_period, 'payouts', jsonb_array_length(p_payouts)), 'web');
    RETURN v_settlement;
  END
  $$;
--> statement-breakpoint

-- An approved member payout is carried out like an approved caregiver
-- payout: an execution keyed by the proposal, and an outbox message for the
-- worker, written in the approval's own transaction. The member's PayPal
-- address, when one is on record, is fixed on the execution now.
CREATE OR REPLACE FUNCTION kin_private.queue_payout() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_execution uuid := gen_random_uuid();
  BEGIN
    INSERT INTO public.executions (id, circle_id, proposal_id, idempotency_key, state, receiver)
      VALUES (v_execution, NEW.circle_id, NEW.id, 'kin-payout-' || NEW.id::text, 'created',
              (SELECT paypal_receiver FROM public.payees
                WHERE circle_id = NEW.circle_id
                  AND ((NEW.payee_id IS NOT NULL AND id = NEW.payee_id)
                    OR (NEW.member_id IS NOT NULL AND member_id = NEW.member_id AND category = 'settlement'))));
    INSERT INTO public.outbox (id, circle_id, topic, payload)
      VALUES (gen_random_uuid(), NEW.circle_id, 'payout.execute', jsonb_build_object('executionId', v_execution));
    IF NEW.settlement_id IS NOT NULL THEN
      UPDATE public.settlements SET state = 'approved' WHERE circle_id = NEW.circle_id AND id = NEW.settlement_id AND state = 'proposed';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

DROP TRIGGER queue_payout ON public.proposals;
--> statement-breakpoint
CREATE TRIGGER queue_payout AFTER UPDATE OF state ON public.proposals
  FOR EACH ROW
  WHEN (OLD.state = 'pending_approval' AND NEW.state = 'approved' AND NEW.kind IN ('caregiver_payout', 'member_payout'))
  EXECUTE FUNCTION kin_private.queue_payout();
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.set_own_settlement_receiver(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.propose_settlement(uuid, text, integer, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.queue_payout() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.set_own_settlement_receiver(uuid, text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.propose_settlement(uuid, text, integer, jsonb, jsonb, jsonb, jsonb) TO kin_app;

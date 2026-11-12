-- Paying a bill Kin read from a letter (docs/architecture.md sections 7.4 to
-- 7.6 and 9.4, decision 105).
--
-- A person who shares the cost reviews the bill: they confirm the payee, the
-- amount and the due day, and say how it is paid. A payee with a PayPal email
-- is paid from the pool by PayPal Payouts, after the yeses the agreement asks
-- for; a payee without one (most utilities) is paid outside Kin by a member,
-- who records it with a receipt that another member approves, as for any
-- receipt. Nothing here moves money or writes the ledger.

-- A bill paid outside Kin closes when its receipt is credited.
INSERT INTO kin_private.state_transitions (machine, from_state, to_state) VALUES ('bill', 'ready', 'paid');
--> statement-breakpoint

-- Confirms a bill read from a letter and, for a payee with a PayPal address,
-- raises its bill_payment proposal in the same transaction. The web app plans
-- the approvals with planBillPayment in packages/domain; this function
-- refuses a plan that asks for fewer or other answers than the agreement in
-- force, as send_caregiver_bill does. The reviewer may correct the amount and
-- the due day, and the name of a payee the family has never approved; an
-- approved payee's name and PayPal address stay as the family approved them,
-- and no payee's address changes while a payment to it waits or is under way,
-- so nobody can redirect money the family already said yes to. A retry
-- returns what the first call did.
CREATE FUNCTION kin_private.review_bill(
  p_circle uuid, p_bill uuid, p_name text, p_cents bigint, p_due date, p_receiver text, p_plan jsonb
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_circle public.circles;
    v_bill public.bills;
    v_payee public.payees;
    v_agreement public.agreements;
    v_member uuid := kin_private.my_member_id(p_circle);
    v_name text := btrim(coalesce(p_name, ''));
    v_receiver text := nullif(lower(btrim(coalesce(p_receiver, ''))), '');
    v_last public.proposals;
    v_now timestamptz;
    v_expires timestamptz;
    v_parent_decides boolean;
    v_first jsonb;
    v_slots jsonb;
    v_proposal uuid;
  BEGIN
    IF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor') THEN
      RAISE EXCEPTION 'kin: bill review refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    SELECT * INTO v_bill FROM public.bills WHERE circle_id = p_circle AND id = p_bill AND caregiver_details IS NULL FOR UPDATE;
    IF NOT FOUND OR v_circle.id IS NULL THEN
      RAISE EXCEPTION 'kin: bill review refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_payee FROM public.payees
      WHERE circle_id = p_circle AND id = v_bill.payee_id AND member_id IS NULL AND voice_id IS NULL FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: bill review refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF length(v_name) NOT BETWEEN 1 AND 80 OR p_cents IS NULL OR p_cents <= 0 OR p_cents > 9007199254740991
       OR (v_receiver IS NOT NULL AND (length(v_receiver) > 127 OR v_receiver !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')) THEN
      RAISE EXCEPTION 'kin: the review is not valid' USING ERRCODE = 'check_violation';
    END IF;

    -- A retry of a review that raised a proposal, or kept the bill to be paid outside Kin, returns what it did.
    SELECT * INTO v_last FROM public.proposals WHERE circle_id = p_circle AND bill_id = p_bill ORDER BY raised_at DESC, id DESC LIMIT 1;
    IF v_bill.state = 'proposed' AND v_last.state NOT IN ('rejected', 'expired', 'cancelled') THEN
      RETURN jsonb_build_object('proposalId', v_last.id, 'route', 'paypal');
    END IF;
    IF v_bill.state = 'ready' AND v_receiver IS NULL AND v_bill.amount_cents = p_cents
       AND v_bill.due_on IS NOT DISTINCT FROM p_due AND v_payee.name = v_name THEN
      RETURN jsonb_build_object('proposalId', NULL, 'route', 'outside');
    END IF;
    -- Waiting for review; kept to be paid outside Kin; or proposed and refused, expired or withdrawn, and reviewed again.
    IF v_bill.state NOT IN ('needs_review', 'ready', 'proposed') THEN
      RAISE EXCEPTION 'kin: the bill is not waiting for review' USING ERRCODE = 'KB005';
    END IF;
    IF EXISTS (SELECT 1 FROM public.receipts WHERE circle_id = p_circle AND bill_id = p_bill AND state <> 'rejected') THEN
      RAISE EXCEPTION 'kin: a member already recorded paying this bill' USING ERRCODE = 'KB005';
    END IF;

    -- What the family approved about a payee stays as they approved it.
    IF v_payee.status = 'approved' AND (v_payee.name <> v_name
       OR (v_receiver IS NOT NULL AND v_payee.paypal_receiver IS NOT NULL AND v_payee.paypal_receiver <> v_receiver)) THEN
      RAISE EXCEPTION 'kin: an approved payee keeps its name and address' USING ERRCODE = 'KB017';
    END IF;
    IF v_receiver IS DISTINCT FROM v_payee.paypal_receiver AND v_receiver IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.proposals
      WHERE circle_id = p_circle AND payee_id = v_payee.id AND state IN ('proposed', 'pending_approval', 'approved', 'executing', 'failed')
    ) THEN
      RAISE EXCEPTION 'kin: a payment to this payee is in progress' USING ERRCODE = 'KB009';
    END IF;

    v_now := coalesce(v_circle.clock_at, now());
    IF v_receiver IS NOT NULL THEN
      SELECT * INTO v_agreement FROM kin_private.agreement_in_force(p_circle);
      IF NOT FOUND THEN
        RAISE EXCEPTION 'kin: the circle has no agreement to approve with' USING ERRCODE = 'KB008';
      END IF;
      IF v_circle.paused_until IS NOT NULL AND v_circle.paused_until > v_now THEN
        RAISE EXCEPTION 'kin: the circle is paused' USING ERRCODE = 'KB007';
      END IF;
      IF p_cents > v_agreement.ceiling_cents THEN
        RAISE EXCEPTION 'kin: the bill is above the agreement''s ceiling' USING ERRCODE = 'KB006';
      END IF;
      v_parent_decides := EXISTS (
        SELECT 1 FROM public.members WHERE circle_id = p_circle AND role = 'parent' AND status = 'active' AND parent_level = 'decides'
      ) AND p_cents > v_agreement.parent_decides_above_cents;
      v_first := CASE WHEN v_parent_decides
        THEN '{"reason": "parent_decides", "roles": ["parent"]}'::jsonb
        ELSE '{"reason": "organizer", "roles": ["organizer"]}'::jsonb END;
      v_slots := CASE WHEN p_cents > v_agreement.second_approval_above_cents
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
         OR p_plan -> 'payeeMemberId' IS DISTINCT FROM 'null'::jsonb
         OR p_plan -> 'announceToCircle' IS DISTINCT FROM to_jsonb(v_payee.status = 'new')
         OR v_expires IS NULL
         OR v_expires NOT BETWEEN v_now + interval '71 hours 55 minutes' AND v_now + interval '72 hours 5 minutes' THEN
        RAISE EXCEPTION 'kin: the approval plan does not match the agreement' USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    UPDATE public.payees SET name = v_name, paypal_receiver = coalesce(v_receiver, paypal_receiver)
      WHERE circle_id = p_circle AND id = v_payee.id AND (name <> v_name OR (v_receiver IS NOT NULL AND paypal_receiver IS DISTINCT FROM v_receiver));
    UPDATE public.bills SET amount_cents = p_cents, due_on = p_due WHERE circle_id = p_circle AND id = p_bill;
    IF v_bill.state <> 'ready' THEN
      UPDATE public.bills SET state = 'ready' WHERE circle_id = p_circle AND id = p_bill;
    END IF;

    IF v_receiver IS NOT NULL THEN
      v_proposal := gen_random_uuid();
      INSERT INTO public.proposals (id, circle_id, kind, cents, payee_id, purpose, raised_by, raised_at, state, expires_at, agreement_version, plan, bill_id, document_id)
        VALUES (v_proposal, p_circle, 'bill_payment', p_cents, v_payee.id, 'letter_bill', v_member,
                v_now, 'pending_approval', v_expires, v_agreement.version, p_plan, p_bill, v_bill.document_id);
      UPDATE public.bills SET state = 'proposed' WHERE circle_id = p_circle AND id = p_bill;
    END IF;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_member, 'bill.reviewed', 'bill', p_bill,
              jsonb_build_object('proposalId', v_proposal, 'route', CASE WHEN v_receiver IS NULL THEN 'outside' ELSE 'paypal' END,
                                 'cents', p_cents, 'newPayee', v_payee.status = 'new'), 'web');
    RETURN jsonb_build_object('proposalId', v_proposal, 'route', CASE WHEN v_receiver IS NULL THEN 'outside' ELSE 'paypal' END);
  END
  $$;
--> statement-breakpoint

-- A member says they paid a reviewed bill outside Kin, from their own pocket.
-- It is filed as their receipt for the bill's own amount, under the payee's
-- name, and waits for another member's yes like any receipt (decide_receipt:
-- nobody decides their own). Once Kin's worker credits it, the bill is paid.
-- The category is packages/domain's outsideReceiptCategory, which this
-- function holds to the payee's own or 'other'. The ID is the caller's, so a
-- retry files it once.
CREATE FUNCTION kin_private.record_bill_paid_outside(
  p_circle uuid, p_bill uuid, p_receipt uuid, p_category text, p_spent_on date
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_member uuid := kin_private.my_member_id(p_circle);
    v_bill public.bills;
    v_payee public.payees;
    v_existing public.receipts;
    v_today date;
  BEGIN
    IF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor') THEN
      RAISE EXCEPTION 'kin: bill payment record refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT (coalesce(c.clock_at, now()) AT TIME ZONE c.timezone)::date INTO v_today FROM public.circles c WHERE c.id = p_circle AND c.status = 'active';
    SELECT * INTO v_bill FROM public.bills WHERE circle_id = p_circle AND id = p_bill AND caregiver_details IS NULL FOR UPDATE;
    IF NOT FOUND OR v_today IS NULL THEN
      RAISE EXCEPTION 'kin: bill payment record refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_existing FROM public.receipts WHERE circle_id = p_circle AND id = p_receipt;
    IF FOUND THEN
      IF v_existing.member_id = v_member AND v_existing.bill_id = p_bill AND v_existing.spent_on = p_spent_on THEN
        RETURN p_receipt;
      END IF;
      RAISE EXCEPTION 'kin: receipt key reused' USING ERRCODE = 'KB004';
    END IF;
    IF v_bill.state <> 'ready' THEN
      RAISE EXCEPTION 'kin: the bill is not waiting to be paid outside Kin' USING ERRCODE = 'KB005';
    END IF;
    SELECT * INTO v_payee FROM public.payees WHERE circle_id = p_circle AND id = v_bill.payee_id;
    IF p_spent_on IS NULL OR p_spent_on > v_today OR p_category IS NULL OR p_category NOT IN (v_payee.category, 'other') THEN
      RAISE EXCEPTION 'kin: the payment record is not valid' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.receipts WHERE circle_id = p_circle AND bill_id = p_bill AND state <> 'rejected') THEN
      RAISE EXCEPTION 'kin: a member already recorded paying this bill' USING ERRCODE = 'KB005';
    END IF;
    INSERT INTO public.receipts (id, circle_id, member_id, category, cents, description, spent_on, bill_id)
      VALUES (p_receipt, p_circle, v_member, p_category, v_bill.amount_cents, left(btrim(v_payee.name), 120), p_spent_on, p_bill);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_member, 'bill.paid_outside', 'bill', p_bill,
              jsonb_build_object('receiptId', p_receipt, 'cents', v_bill.amount_cents), 'web');
    RETURN p_receipt;
  END
  $$;
--> statement-breakpoint

-- An approved bill payment is carried out like a caregiver's or a member's
-- payout: the same execution keyed by the proposal and the same outbox
-- message, written in the approval's own transaction (queue_payout, 0033).
DROP TRIGGER queue_payout ON public.proposals;
--> statement-breakpoint
CREATE TRIGGER queue_payout AFTER UPDATE OF state ON public.proposals
  FOR EACH ROW
  WHEN (OLD.state = 'pending_approval' AND NEW.state = 'approved' AND NEW.kind IN ('caregiver_payout', 'member_payout', 'bill_payment'))
  EXECUTE FUNCTION kin_private.queue_payout();
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.review_bill(uuid, uuid, text, bigint, date, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.record_bill_paid_outside(uuid, uuid, uuid, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.review_bill(uuid, uuid, text, bigint, date, text, jsonb) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.record_bill_paid_outside(uuid, uuid, uuid, text, date) TO kin_app;

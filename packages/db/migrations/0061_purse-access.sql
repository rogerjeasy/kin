-- The parent's Purse: who may see and write it, and the rules the database holds to.
-- Tables purses, purse_payees and purse_payments, and their checks, come from the
-- generated migration before this one; this file adds their access rules, the
-- triggers that fix what was asked for, and the operations that write.
--
-- Plain code in packages/domain (purse.ts) decides whether a payment goes, waits
-- or is refused. The database holds the parts of that decision it can hold again
-- and keeps the record:
--   * only the parent spends her Purse, and only she says yes: her answer is the
--     recorded approval of the payment (AGENTS.md section 5, rule 4);
--   * a payment to someone not in the verified address book, or above the cap,
--     is held, whatever the app sends: the database re-derives those reasons and
--     refuses a request that leaves them out, and a reason once recorded never
--     changes, so nothing can lower a hold;
--   * a held payment becomes approved only after its hold ends, to a verified
--     payee, and never after anyone cancelled it;
--   * a payment that is not held must fit what she may still spend: the Purse's
--     balance in the ledger less every payment already said yes to;
--   * the family reads a payment only with her recorded consent or when it was
--     held (row-level security); the ledger's own entry names no payee.
--
-- Refusals that screens word, by SQLSTATE:
--   42501  the person may not do this
--   23514  the request is not one Kin can hold
--   KU001  there is no Purse, or it is not active
--   KU002  outgoing money is held: the circle is paused, or a check holds it
--   KU003  more than she may still spend
--   KU004  the payment is not waiting for this (answered, expired, not held)
--   KU005  the request leaves out a reason to hold it, or names an unverified payee
--   KU006  the address book is full
--   KU007  a member cannot verify an entry they added
--   KU008  the ceiling is above the family agreement's
--   KU009  too many requests this hour
ALTER TABLE public.purses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purse_payees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purse_payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY service_own_circle ON public.purses FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY service_own_circle ON public.purse_payees FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY service_own_circle ON public.purse_payments FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY provisioner_new_circle ON public.purses FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
CREATE POLICY provisioner_new_circle ON public.purse_payees FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
-- The Purse's terms and her address book: whoever sees the circle's money.
CREATE POLICY app_member_read ON public.purses FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));
CREATE POLICY app_member_read ON public.purse_payees FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));
-- Her payments are hers: the parent reads every one; the rest of the family only
-- those she shared, and those that raised a flag by being held. A caregiver none.
CREATE POLICY app_parent_read ON public.purse_payments FOR SELECT TO kin_app
  USING (coalesce(kin_private.my_role(circle_id) = 'parent', false));
CREATE POLICY app_family_read ON public.purse_payments FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id) AND (shared_at IS NOT NULL OR held_at IS NOT NULL));
--> statement-breakpoint

GRANT SELECT ON public.purses, public.purse_payees, public.purse_payments TO kin_app;
GRANT SELECT ON public.purses, public.purse_payees, public.purse_payments TO kin_service;
-- The worker moves a payment along and records PayPal's answer. It never changes what she asked for.
GRANT UPDATE (state, receiver, paypal_batch_id, paypal_item_id, fee_cents, attempts, last_error, submitted_at, paid_at, reconciled_at)
  ON public.purse_payments TO kin_service;
GRANT INSERT ON public.purses, public.purse_payees TO kin_provisioner;
--> statement-breakpoint

-- A payment moves along PURSE_PAYMENT_TRANSITIONS in packages/domain, held to it by a test.
INSERT INTO kin_private.state_transitions (machine, from_state, to_state) VALUES
  ('purse_payment', 'proposed', 'approved'),
  ('purse_payment', 'proposed', 'held'),
  ('purse_payment', 'proposed', 'declined'),
  ('purse_payment', 'proposed', 'expired'),
  ('purse_payment', 'held', 'approved'),
  ('purse_payment', 'held', 'cancelled'),
  ('purse_payment', 'held', 'expired'),
  ('purse_payment', 'approved', 'executing'),
  ('purse_payment', 'executing', 'paid'),
  ('purse_payment', 'executing', 'failed'),
  ('purse_payment', 'executing', 'unknown'),
  ('purse_payment', 'unknown', 'paid'),
  ('purse_payment', 'unknown', 'failed');
--> statement-breakpoint

CREATE TRIGGER state_moves_forward BEFORE UPDATE OF state ON public.purse_payments
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_transition('purse_payment');
--> statement-breakpoint

-- What she asked for never changes once it is read back: the payee, the amount,
-- her words, the reasons to hold it and the sentence she heard. An address is
-- fixed once; her answer, a hold and a cancellation are each written once.
CREATE FUNCTION kin_private.assert_purse_payment_fixed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_moving text[] := ARRAY['state', 'answered_at', 'answer_method', 'answer_evidence', 'held_at', 'hold_ends_at', 'cancelled_at', 'cancelled_by', 'pressured',
                             'shared_at', 'receiver', 'paypal_batch_id', 'paypal_item_id', 'fee_cents', 'attempts', 'last_error', 'submitted_at', 'paid_at', 'reconciled_at'];
  BEGIN
    IF (to_jsonb(NEW) - v_moving) IS DISTINCT FROM (to_jsonb(OLD) - v_moving) THEN
      RAISE EXCEPTION 'kin: a Purse payment cannot change what was asked for' USING ERRCODE = 'restrict_violation';
    END IF;
    IF (OLD.receiver IS NOT NULL AND NEW.receiver IS DISTINCT FROM OLD.receiver)
       OR (OLD.answered_at IS NOT NULL AND (NEW.answered_at, NEW.answer_method, NEW.answer_evidence) IS DISTINCT FROM (OLD.answered_at, OLD.answer_method, OLD.answer_evidence))
       OR (OLD.held_at IS NOT NULL AND (NEW.held_at, NEW.hold_ends_at) IS DISTINCT FROM (OLD.held_at, OLD.hold_ends_at))
       OR (OLD.cancelled_at IS NOT NULL AND (NEW.cancelled_at, NEW.cancelled_by, NEW.pressured) IS DISTINCT FROM (OLD.cancelled_at, OLD.cancelled_by, OLD.pressured))
       OR (OLD.paid_at IS NOT NULL AND NEW.paid_at IS DISTINCT FROM OLD.paid_at) THEN
      RAISE EXCEPTION 'kin: a Purse payment''s answer, hold, address and payment are each written once' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

CREATE TRIGGER purse_payment_fixed BEFORE UPDATE ON public.purse_payments
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_purse_payment_fixed();
--> statement-breakpoint

-- The rules a move must keep, whoever makes it. Approval needs her yes; a held
-- payment is approved only once its hold has ended, never after a cancellation,
-- and only for a payee still verified in her book; nothing is sent without an
-- address; and a payment is cancelled only while it is held.
CREATE FUNCTION kin_private.assert_purse_payment_move() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_now timestamptz;
  BEGIN
    IF NEW.state IS NOT DISTINCT FROM OLD.state THEN
      RETURN NEW;
    END IF;
    SELECT coalesce(c.clock_at, now()) INTO v_now FROM public.circles c WHERE c.id = NEW.circle_id;
    IF NEW.state IN ('approved', 'held') AND NEW.answered_at IS NULL THEN
      RAISE EXCEPTION 'kin: a Purse payment needs her yes' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.state = 'held' AND NEW.held_at IS NULL THEN
      RAISE EXCEPTION 'kin: a held Purse payment needs its hold' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.state = 'approved' AND cardinality(NEW.hold_reasons) > 0 AND (OLD.state <> 'held' OR v_now < OLD.hold_ends_at) THEN
      RAISE EXCEPTION 'kin: a held Purse payment waits until its hold ends' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.state = 'approved' AND (NEW.cancelled_at IS NOT NULL OR NEW.payee_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.purse_payees p WHERE p.circle_id = NEW.circle_id AND p.id = NEW.payee_id AND p.verified_at IS NOT NULL AND p.removed_at IS NULL
    )) THEN
      RAISE EXCEPTION 'kin: a Purse payment goes only to a verified payee' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.state = 'executing' AND NEW.receiver IS NULL THEN
      RAISE EXCEPTION 'kin: a Purse payment is not sent without its address' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.state = 'cancelled' AND (OLD.state <> 'held' OR NEW.cancelled_at IS NULL) THEN
      RAISE EXCEPTION 'kin: only a held Purse payment is cancelled' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

CREATE TRIGGER purse_payment_move BEFORE UPDATE OF state ON public.purse_payments
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_purse_payment_move();
--> statement-breakpoint

-- An address-book entry's name and address never change: only its one
-- verification and its one removal.
CREATE FUNCTION kin_private.assert_purse_payee_fixed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF (to_jsonb(NEW) - ARRAY['verified_by', 'verified_at', 'removed_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['verified_by', 'verified_at', 'removed_at'])
       OR (OLD.verified_at IS NOT NULL AND (NEW.verified_by, NEW.verified_at) IS DISTINCT FROM (OLD.verified_by, OLD.verified_at))
       OR (OLD.removed_at IS NOT NULL AND NEW.removed_at IS DISTINCT FROM OLD.removed_at) THEN
      RAISE EXCEPTION 'kin: an address-book entry is verified once and removed once, and never changed' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

CREATE TRIGGER purse_payee_fixed BEFORE UPDATE ON public.purse_payees
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_purse_payee_fixed();
--> statement-breakpoint

-- Whether the Purse may be spent now: it is active, the circle is not paused on
-- its own clock, and no "is it really you?" check holds outgoing money (on the
-- real clock, as that hold is timed). Every operation that spends or funds the
-- Purse asks this, so a new reason to stop spending is added here once.
CREATE FUNCTION kin_private.purse_spending_allowed(p_circle uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.purses p
      JOIN public.circles c ON c.id = p.circle_id
      WHERE p.circle_id = p_circle AND p.status = 'active' AND c.status = 'active'
        AND (c.paused_until IS NULL OR c.paused_until <= coalesce(c.clock_at, now()))
        AND NOT EXISTS (SELECT 1 FROM public.presence_checks h WHERE h.circle_id = p_circle AND h.hold_until > now())
        -- Her own wish pauses what is spent for her beyond care while a trigger is active
        -- (discretionaryPause in packages/domain; security/purse-wishes.test.ts holds them to one answer).
        AND NOT EXISTS (
          SELECT 1 FROM public.wish_triggers t
          JOIN public.wishes w ON w.circle_id = t.circle_id
          WHERE t.circle_id = p_circle AND t.state = 'active' AND t.active_at IS NOT NULL
            AND w.state = 'in_force' AND w.rule_kind = 'pause_discretionary' AND w.trigger IN (t.event, 'either')
        )
    )
  $$;
--> statement-breakpoint

-- What she may still spend: the Purse's balance in the ledger, less every
-- payment already said yes to that has not left (purseReservedCents in
-- packages/domain): a held payment to someone not in her verified book holds
-- nothing back, as it can never be paid. Internal: no role calls it.
CREATE FUNCTION kin_private.purse_available(p_circle uuid) RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT greatest(0,
      coalesce((SELECT sum(CASE WHEN l.direction = 'debit' THEN l.cents ELSE -l.cents END)
                FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.circle_id = l.circle_id AND a.id = l.account_id
                WHERE l.circle_id = p_circle AND a.code = 'purse_cash'), 0)
      - coalesce((SELECT sum(pp.cents) FROM public.purse_payments pp
                  WHERE pp.circle_id = p_circle AND pp.state IN ('held', 'approved', 'executing', 'unknown')
                    AND (pp.state <> 'held' OR EXISTS (SELECT 1 FROM public.purse_payees p WHERE p.circle_id = pp.circle_id AND p.id = pp.payee_id AND p.verified_at IS NOT NULL AND p.removed_at IS NULL))), 0))::bigint
  $$;
--> statement-breakpoint

-- The organizer sets the Purse up, or changes its terms: an approved family
-- decision, recorded with the old and the new terms. The ceiling never passes
-- the family agreement's. A revoked Purse is never set up again.
CREATE FUNCTION kin_private.set_purse(p_circle uuid, p_weekly bigint, p_ceiling bigint, p_cap bigint) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_parent uuid;
    v_agreement public.agreements;
    v_old public.purses;
    v_id uuid;
    v_now timestamptz;
  BEGIN
    IF v_me IS NULL OR kin_private.my_role(p_circle) <> 'organizer' THEN
      RAISE EXCEPTION 'kin: setting up the Purse refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    SELECT id INTO v_parent FROM public.members WHERE circle_id = p_circle AND role = 'parent' AND status = 'active' ORDER BY joined_at, id LIMIT 1;
    IF v_circle.id IS NULL OR v_parent IS NULL THEN
      RAISE EXCEPTION 'kin: the circle has no parent for a Purse' USING ERRCODE = 'KU001';
    END IF;
    SELECT * INTO v_agreement FROM kin_private.agreement_in_force(p_circle);
    IF v_agreement.id IS NULL OR p_ceiling > v_agreement.ceiling_cents THEN
      RAISE EXCEPTION 'kin: the Purse ceiling passes the agreement' USING ERRCODE = 'KU008';
    END IF;
    v_now := date_trunc('second', coalesce(v_circle.clock_at, now()));
    SELECT * INTO v_old FROM public.purses WHERE circle_id = p_circle FOR UPDATE;
    IF v_old.id IS NOT NULL AND v_old.status = 'revoked' THEN
      RAISE EXCEPTION 'kin: a revoked Purse is not set up again' USING ERRCODE = 'KU001';
    END IF;
    IF v_old.id IS NULL THEN
      v_id := gen_random_uuid();
      INSERT INTO public.purses (id, circle_id, parent_member_id, weekly_cents, ceiling_cents, per_payment_cents, status, set_by, set_at, simulated)
        VALUES (v_id, p_circle, v_parent, p_weekly, p_ceiling, p_cap, 'active', v_me, v_now, v_circle.demo);
    ELSE
      v_id := v_old.id;
      UPDATE public.purses SET weekly_cents = p_weekly, ceiling_cents = p_ceiling, per_payment_cents = p_cap, set_by = v_me, set_at = v_now
        WHERE id = v_id;
    END IF;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'purse.terms_set', 'purse', v_id,
              jsonb_build_object('weeklyCents', p_weekly, 'ceilingCents', p_ceiling, 'perPaymentCents', p_cap,
                                 'before', CASE WHEN v_old.id IS NULL THEN NULL ELSE jsonb_build_object('weeklyCents', v_old.weekly_cents, 'ceilingCents', v_old.ceiling_cents, 'perPaymentCents', v_old.per_payment_cents) END), 'web');
    RETURN v_id;
  END
  $$;
--> statement-breakpoint

-- Pausing is always safe: the parent or anyone who answers for the family.
-- Starting it again, or ending it for good, is the organizer's decision.
CREATE FUNCTION kin_private.set_purse_status(p_circle uuid, p_status text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_purse public.purses;
  BEGIN
    IF v_me IS NULL OR p_status NOT IN ('active', 'paused', 'revoked')
       OR (p_status = 'paused' AND v_role NOT IN ('organizer', 'contributor', 'parent'))
       OR (p_status <> 'paused' AND v_role <> 'organizer') THEN
      RAISE EXCEPTION 'kin: changing the Purse refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_purse FROM public.purses WHERE circle_id = p_circle FOR UPDATE;
    IF v_purse.id IS NULL OR v_purse.status = 'revoked' THEN
      RAISE EXCEPTION 'kin: there is no Purse to change' USING ERRCODE = 'KU001';
    END IF;
    IF v_purse.status = p_status THEN
      RETURN;
    END IF;
    UPDATE public.purses SET status = p_status WHERE id = v_purse.id;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'purse.status_set', 'purse', v_purse.id, jsonb_build_object('status', p_status, 'before', v_purse.status), 'web');
  END
  $$;
--> statement-breakpoint

-- Someone she may pay. The parent or a member who answers for the family adds
-- them; another such member verifies them before a payment can go on her yes.
CREATE FUNCTION kin_private.add_purse_payee(p_circle uuid, p_name text, p_relationship text, p_kind text, p_receiver text, p_aliases text[]) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_id uuid := gen_random_uuid();
  BEGIN
    IF v_me IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor', 'parent') THEN
      RAISE EXCEPTION 'kin: the address book refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    IF v_circle.id IS NULL THEN
      RAISE EXCEPTION 'kin: the address book refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF (SELECT count(*) FROM public.purse_payees WHERE circle_id = p_circle AND removed_at IS NULL) >= 24 THEN
      RAISE EXCEPTION 'kin: the address book is full' USING ERRCODE = 'KU006';
    END IF;
    INSERT INTO public.purse_payees (id, circle_id, name, relationship, kind, aliases, paypal_receiver, added_by, simulated)
      VALUES (v_id, p_circle, btrim(p_name), btrim(p_relationship), p_kind, coalesce(p_aliases, '{}'), lower(btrim(p_receiver)), v_me, v_circle.demo);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'purse.payee_added', 'purse_payee', v_id, '{}'::jsonb, 'web');
    RETURN v_id;
  END
  $$;
--> statement-breakpoint

CREATE FUNCTION kin_private.verify_purse_payee(p_circle uuid, p_payee uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_payee public.purse_payees;
    v_now timestamptz;
  BEGIN
    IF v_me IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor') THEN
      RAISE EXCEPTION 'kin: verifying refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_payee FROM public.purse_payees WHERE circle_id = p_circle AND id = p_payee FOR UPDATE;
    IF v_payee.id IS NULL OR v_payee.removed_at IS NOT NULL OR v_payee.verified_at IS NOT NULL THEN
      RAISE EXCEPTION 'kin: the entry is not waiting to be verified' USING ERRCODE = 'KU004';
    END IF;
    IF v_payee.added_by = v_me THEN
      RAISE EXCEPTION 'kin: someone else verifies what you added' USING ERRCODE = 'KU007';
    END IF;
    SELECT date_trunc('second', coalesce(clock_at, now())) INTO v_now FROM public.circles WHERE id = p_circle;
    UPDATE public.purse_payees SET verified_by = v_me, verified_at = v_now WHERE id = p_payee;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'purse.payee_verified', 'purse_payee', p_payee, '{}'::jsonb, 'web');
  END
  $$;
--> statement-breakpoint

CREATE FUNCTION kin_private.remove_purse_payee(p_circle uuid, p_payee uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
  BEGIN
    IF v_me IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor', 'parent') THEN
      RAISE EXCEPTION 'kin: the address book refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE public.purse_payees SET removed_at = now() WHERE circle_id = p_circle AND id = p_payee AND removed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: the entry is not in the address book' USING ERRCODE = 'KU004';
    END IF;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'purse.payee_removed', 'purse_payee', p_payee, '{}'::jsonb, 'web');
  END
  $$;
--> statement-breakpoint

-- The parent asks Kin to pay someone, and Kin reads it back. Nothing is approved
-- yet: her yes, given next, is the approval. The app's plain code decided the
-- reasons to hold it; the database refuses a request that leaves out the ones it
-- can see for itself (someone not in the verified book, an amount above the cap),
-- and one that would not hold but is more than she may still spend.
CREATE FUNCTION kin_private.propose_purse_payment(
  p_circle uuid, p_payee uuid, p_payee_name text, p_cents bigint, p_memo text, p_words text, p_route text,
  p_markers text[], p_reasons text[], p_read_back text, p_read_back_source text
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_purse public.purses;
    v_payee public.purse_payees;
    v_id uuid := gen_random_uuid();
    v_now timestamptz;
    v_expires timestamptz;
  BEGIN
    IF v_me IS NULL OR kin_private.my_role(p_circle) <> 'parent' THEN
      RAISE EXCEPTION 'kin: only she spends her Purse' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    SELECT * INTO v_purse FROM public.purses WHERE circle_id = p_circle FOR UPDATE;
    IF v_circle.id IS NULL OR v_purse.id IS NULL OR v_purse.parent_member_id <> v_me THEN
      RAISE EXCEPTION 'kin: only she spends her Purse' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_purse.status <> 'active' THEN
      RAISE EXCEPTION 'kin: the Purse is not active' USING ERRCODE = 'KU001';
    END IF;
    IF NOT kin_private.purse_spending_allowed(p_circle) THEN
      RAISE EXCEPTION 'kin: outgoing money is held' USING ERRCODE = 'KU002';
    END IF;
    IF p_cents IS NULL OR p_cents <= 0 OR p_reasons IS NULL OR p_markers IS NULL THEN
      RAISE EXCEPTION 'kin: the request is not valid' USING ERRCODE = 'check_violation';
    END IF;
    IF (SELECT count(*) FROM public.purse_payments WHERE circle_id = p_circle AND created_at > now() - interval '1 hour') >= 20 THEN
      RAISE EXCEPTION 'kin: too many requests this hour' USING ERRCODE = 'KU009';
    END IF;
    IF p_payee IS NOT NULL THEN
      SELECT * INTO v_payee FROM public.purse_payees WHERE circle_id = p_circle AND id = p_payee;
      IF v_payee.id IS NULL OR v_payee.removed_at IS NOT NULL OR v_payee.verified_at IS NULL THEN
        RAISE EXCEPTION 'kin: the payee is not verified' USING ERRCODE = 'KU005';
      END IF;
    ELSIF NOT ('new_payee' = ANY (p_reasons)) THEN
      RAISE EXCEPTION 'kin: a new payee is held' USING ERRCODE = 'KU005';
    END IF;
    IF p_cents > v_purse.per_payment_cents AND NOT ('above_cap' = ANY (p_reasons)) THEN
      RAISE EXCEPTION 'kin: an amount above the cap is held' USING ERRCODE = 'KU005';
    END IF;
    IF cardinality(p_reasons) = 0 AND p_cents > kin_private.purse_available(p_circle) THEN
      RAISE EXCEPTION 'kin: more than she may still spend' USING ERRCODE = 'KU003';
    END IF;
    v_now := coalesce(v_circle.clock_at, now());
    v_expires := v_now + interval '15 minutes';
    INSERT INTO public.purse_payments (id, circle_id, purse_id, payee_id, payee_name, cents, memo, words, route, markers, hold_reasons,
                                       read_back, read_back_source, state, proposed_at, expires_at, idempotency_key, simulated)
      VALUES (v_id, p_circle, v_purse.id, v_payee.id, coalesce(v_payee.name, btrim(p_payee_name)), p_cents, nullif(btrim(coalesce(p_memo, '')), ''), p_words, p_route,
              p_markers, p_reasons, p_read_back, p_read_back_source, 'proposed', v_now, v_expires, 'kin-purse-' || v_id::text, v_circle.demo);
    RETURN jsonb_build_object('id', v_id, 'expiresAt', v_expires);
  END
  $$;
--> statement-breakpoint

-- Her answer to what Kin read back. A no ends it. A yes is the approval: a
-- payment with a reason to wait is held for its cooling-off and the family is
-- told (the hold makes it visible to them and is in the audit log); any other is
-- approved, if it still fits, and the worker pays it. To a payment Kin would
-- hold she may also answer that someone is telling her what to do: it is held,
-- so the family sees it, and stopped at once in her name, marked pressured.
CREATE FUNCTION kin_private.answer_purse_payment(p_circle uuid, p_payment uuid, p_answer text, p_method text, p_evidence text) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_payment public.purse_payments;
    v_receiver text;
    v_now timestamptz;
  BEGIN
    IF v_me IS NULL OR kin_private.my_role(p_circle) <> 'parent' THEN
      RAISE EXCEPTION 'kin: only she answers for her Purse' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_answer NOT IN ('yes', 'no', 'pressured') OR p_method NOT IN ('app', 'voice') OR length(coalesce(p_evidence, '')) NOT BETWEEN 1 AND 400 THEN
      RAISE EXCEPTION 'kin: the answer is not valid' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    SELECT pp.* INTO v_payment FROM public.purse_payments pp JOIN public.purses p ON p.circle_id = pp.circle_id AND p.id = pp.purse_id
      WHERE pp.circle_id = p_circle AND pp.id = p_payment AND p.parent_member_id = v_me FOR UPDATE OF pp;
    IF v_circle.id IS NULL OR v_payment.id IS NULL THEN
      RAISE EXCEPTION 'kin: only she answers for her Purse' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_now := date_trunc('second', coalesce(v_circle.clock_at, now()));
    IF v_payment.state <> 'proposed' OR v_now > v_payment.expires_at THEN
      RAISE EXCEPTION 'kin: the payment is not waiting for her answer' USING ERRCODE = 'KU004';
    END IF;
    IF p_answer = 'no' THEN
      UPDATE public.purse_payments SET state = 'declined', answered_at = v_now, answer_method = p_method, answer_evidence = p_evidence WHERE id = p_payment;
      RETURN 'declined';
    END IF;
    IF p_answer = 'pressured' THEN
      IF cardinality(v_payment.hold_reasons) = 0 THEN
        RAISE EXCEPTION 'kin: that answer is for a payment Kin would hold' USING ERRCODE = 'check_violation';
      END IF;
      UPDATE public.purse_payments
        SET state = 'held', answered_at = v_now, answer_method = p_method, answer_evidence = p_evidence,
            held_at = v_now, hold_ends_at = v_now + interval '24 hours'
        WHERE id = p_payment;
      UPDATE public.purse_payments SET state = 'cancelled', cancelled_at = v_now, cancelled_by = v_me, pressured = true WHERE id = p_payment;
      INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
        VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'purse.stopped_pressured', 'purse_payment', p_payment,
                jsonb_build_object('reasons', to_jsonb(v_payment.hold_reasons), 'cents', v_payment.cents), 'web');
      RETURN 'stopped';
    END IF;
    IF NOT kin_private.purse_spending_allowed(p_circle) THEN
      RAISE EXCEPTION 'kin: outgoing money is held' USING ERRCODE = 'KU002';
    END IF;
    IF cardinality(v_payment.hold_reasons) > 0 THEN
      UPDATE public.purse_payments
        SET state = 'held', answered_at = v_now, answer_method = p_method, answer_evidence = p_evidence,
            held_at = v_now, hold_ends_at = v_now + interval '24 hours'
        WHERE id = p_payment;
      INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
        VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'purse.held', 'purse_payment', p_payment,
                jsonb_build_object('reasons', to_jsonb(v_payment.hold_reasons), 'cents', v_payment.cents), 'web');
      RETURN 'held';
    END IF;
    IF v_payment.cents > kin_private.purse_available(p_circle) THEN
      RAISE EXCEPTION 'kin: more than she may still spend' USING ERRCODE = 'KU003';
    END IF;
    SELECT paypal_receiver INTO v_receiver FROM public.purse_payees
      WHERE circle_id = p_circle AND id = v_payment.payee_id AND verified_at IS NOT NULL AND removed_at IS NULL;
    IF v_receiver IS NULL THEN
      RAISE EXCEPTION 'kin: the payee is not verified' USING ERRCODE = 'KU005';
    END IF;
    UPDATE public.purse_payments
      SET state = 'approved', answered_at = v_now, answer_method = p_method, answer_evidence = p_evidence, receiver = v_receiver
      WHERE id = p_payment;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'purse.approved', 'purse_payment', p_payment, '{}'::jsonb, 'web');
    RETURN 'approved';
  END
  $$;
--> statement-breakpoint

-- A held payment is stopped during its cooling-off: by her, or by a member who
-- answers for the family. Nobody can make or approve one but her.
CREATE FUNCTION kin_private.cancel_purse_payment(p_circle uuid, p_payment uuid, p_pressured boolean) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_now timestamptz;
  BEGIN
    IF v_me IS NULL OR v_role NOT IN ('organizer', 'contributor', 'parent') THEN
      RAISE EXCEPTION 'kin: cancelling refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT date_trunc('second', coalesce(clock_at, now())) INTO v_now FROM public.circles WHERE id = p_circle AND status = 'active';
    -- Only she can say she was pressured; the family's cancellation says only that they stopped it.
    UPDATE public.purse_payments SET state = 'cancelled', cancelled_at = v_now, cancelled_by = v_me, pressured = (coalesce(p_pressured, false) AND v_role = 'parent')
      WHERE circle_id = p_circle AND id = p_payment AND state = 'held';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: the payment is not held' USING ERRCODE = 'KU004';
    END IF;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'purse.cancelled', 'purse_payment', p_payment,
              jsonb_build_object('role', v_role, 'pressured', coalesce(p_pressured, false)), 'web');
  END
  $$;
--> statement-breakpoint

-- Her consent for the family to see one payment, given or taken back. A held
-- payment stays visible to them either way: it raised a flag.
CREATE FUNCTION kin_private.share_purse_payment(p_circle uuid, p_payment uuid, p_share boolean) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_now timestamptz;
  BEGIN
    IF v_me IS NULL OR kin_private.my_role(p_circle) <> 'parent' OR p_share IS NULL THEN
      RAISE EXCEPTION 'kin: only she shares her Purse' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT date_trunc('second', coalesce(clock_at, now())) INTO v_now FROM public.circles WHERE id = p_circle AND status = 'active';
    UPDATE public.purse_payments pp SET shared_at = CASE WHEN p_share THEN coalesce(pp.shared_at, v_now) ELSE NULL END
      FROM public.purses p
      WHERE pp.circle_id = p_circle AND pp.id = p_payment AND p.circle_id = pp.circle_id AND p.id = pp.purse_id AND p.parent_member_id = v_me;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: only she shares her Purse' USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, CASE WHEN p_share THEN 'purse.shared' ELSE 'purse.unshared' END, 'purse_payment', p_payment, '{}'::jsonb, 'web');
  END
  $$;
--> statement-breakpoint

-- The circles with Purse work for the worker: a Purse to fund, or a payment to
-- move along or reconcile. As Kin's service only.
CREATE FUNCTION kin_private.purse_circles() RETURNS SETOF uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF session_user <> 'kin_service' THEN
      RAISE EXCEPTION 'kin: only Kin''s service runs the Purse' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN QUERY
      SELECT p.circle_id FROM public.purses p JOIN public.circles c ON c.id = p.circle_id
        WHERE c.status = 'active' AND (p.status = 'active' OR EXISTS (
          SELECT 1 FROM public.purse_payments pp WHERE pp.circle_id = p.circle_id
            AND (pp.state IN ('proposed', 'held', 'approved', 'executing', 'unknown') OR (pp.state = 'paid' AND NOT pp.simulated AND pp.reconciled_at IS NULL))
        ))
        ORDER BY p.circle_id LIMIT 200;
  END
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.purse_spending_allowed(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.purse_available(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.set_purse(uuid, bigint, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.set_purse_status(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.add_purse_payee(uuid, text, text, text, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.verify_purse_payee(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.remove_purse_payee(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.propose_purse_payment(uuid, uuid, text, bigint, text, text, text, text[], text[], text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.answer_purse_payment(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.cancel_purse_payment(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.share_purse_payment(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.purse_circles() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.assert_purse_payment_fixed() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.assert_purse_payment_move() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.assert_purse_payee_fixed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.purse_spending_allowed(uuid) TO kin_app, kin_service;
GRANT EXECUTE ON FUNCTION kin_private.set_purse(uuid, bigint, bigint, bigint) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.set_purse_status(uuid, text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.add_purse_payee(uuid, text, text, text, text, text[]) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.verify_purse_payee(uuid, uuid) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.remove_purse_payee(uuid, uuid) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.propose_purse_payment(uuid, uuid, text, bigint, text, text, text, text[], text[], text, text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.answer_purse_payment(uuid, uuid, text, text, text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.cancel_purse_payment(uuid, uuid, boolean) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.share_purse_payment(uuid, uuid, boolean) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.purse_circles() TO kin_service;

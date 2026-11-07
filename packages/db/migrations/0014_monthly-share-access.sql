-- Who may read and change a member's monthly share (docs/architecture.md
-- section 8.4), for the table made in 0013.
--
-- Everyone but a caregiver reads every share in the circle: the family's
-- commitments are open to the family. A person writes nothing directly. They
-- start, pause, resume and cancel their own share through the two functions
-- below, which recheck the role and the seat. What PayPal charged reaches the
-- ledger only through the worker, as the service.
ALTER TABLE public.monthly_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_own_circle ON public.monthly_shares FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id())
  WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY provisioner_new_circle ON public.monthly_shares FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
CREATE POLICY app_member_read ON public.monthly_shares FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));

GRANT SELECT ON public.monthly_shares TO kin_app;
GRANT SELECT, INSERT, UPDATE ON public.monthly_shares TO kin_service;
GRANT INSERT ON public.monthly_shares TO kin_provisioner;
--> statement-breakpoint

-- A share only moves along the diagram in packages/domain (MONTHLY_SHARE_TRANSITIONS):
-- it waits for approval, runs, pauses and resumes, and a cancelled one stays
-- cancelled. Late or repeated news from PayPal cannot reopen it.
CREATE FUNCTION kin_private.guard_monthly_share_move() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.state IS NOT DISTINCT FROM OLD.state THEN
      NEW.updated_at := now();
      RETURN NEW;
    END IF;
    IF NOT (
      (OLD.state = 'approval_pending' AND NEW.state IN ('active', 'cancelled'))
      OR (OLD.state = 'active' AND NEW.state IN ('paused', 'cancelled'))
      OR (OLD.state = 'paused' AND NEW.state IN ('active', 'cancelled'))
    ) THEN
      RAISE EXCEPTION 'kin: a % monthly share cannot become %', OLD.state, NEW.state USING ERRCODE = 'KB011';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END
  $$;

CREATE TRIGGER monthly_share_moves_forward BEFORE UPDATE ON public.monthly_shares
  FOR EACH ROW EXECUTE FUNCTION kin_private.guard_monthly_share_move();
--> statement-breakpoint

-- Records the member's own new share. A real circle's share is the PayPal
-- subscription Kin just made, waiting for the member to approve it; a demo
-- circle's share is simulated, has no subscription and runs at once. A share
-- that was never approved is replaced; one that runs or is paused must be
-- cancelled first. The amount is held to a top-up's limits, as the domain's
-- checkMonthlyShare does.
CREATE FUNCTION kin_private.start_my_share(p_circle uuid, p_id uuid, p_cents bigint, p_paypal text, p_approval text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_circle public.circles;
    v_me uuid;
    v_old public.monthly_shares;
  BEGIN
    IF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor') THEN
      RAISE EXCEPTION 'kin: monthly share refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_me := kin_private.my_member_id(p_circle);
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    IF NOT FOUND OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: monthly share refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- Simulated money only in a demo circle, and real subscriptions only in a real one.
    IF v_circle.demo <> (p_paypal IS NULL) THEN
      RAISE EXCEPTION 'kin: monthly share refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_paypal IS NOT NULL AND (p_paypal !~ '^I-[A-Z0-9]{6,34}$' OR p_approval IS NULL OR p_approval !~ '^https://[^[:space:]]+$' OR length(p_approval) > 2000) THEN
      RAISE EXCEPTION 'kin: monthly share needs a PayPal subscription' USING ERRCODE = 'check_violation';
    END IF;
    IF v_circle.currency <> 'USD' OR p_cents NOT BETWEEN 100 AND 500000 THEN
      RAISE EXCEPTION 'kin: monthly share amount refused' USING ERRCODE = 'check_violation';
    END IF;

    SELECT * INTO v_old FROM public.monthly_shares
      WHERE circle_id = p_circle AND member_id = v_me AND state <> 'cancelled' FOR UPDATE;
    IF FOUND THEN
      IF v_old.state <> 'approval_pending' THEN
        RAISE EXCEPTION 'kin: a monthly share is already running' USING ERRCODE = 'KB010';
      END IF;
      UPDATE public.monthly_shares SET state = 'cancelled' WHERE id = v_old.id AND circle_id = p_circle;
    END IF;

    INSERT INTO public.monthly_shares (id, circle_id, member_id, amount_cents, currency, state, paypal_subscription_id, approval_url, simulated)
      VALUES (p_id, p_circle, v_me, p_cents, v_circle.currency,
              CASE WHEN v_circle.demo THEN 'active'::public.monthly_share_state ELSE 'approval_pending'::public.monthly_share_state END,
              p_paypal, p_approval, v_circle.demo);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'monthly_share.started', 'monthly_share', p_id,
              jsonb_build_object('cents', p_cents, 'simulated', v_circle.demo), 'web');
    RETURN p_id;
  END
  $$;

REVOKE ALL ON FUNCTION kin_private.start_my_share(uuid, uuid, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.start_my_share(uuid, uuid, bigint, text, text) TO kin_app;
--> statement-breakpoint

-- Pauses, resumes or cancels the member's own share, once PayPal has done
-- the same. Only the owner of the share may, and only along the diagram.
CREATE FUNCTION kin_private.move_my_share(p_circle uuid, p_share uuid, p_state public.monthly_share_state) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid;
    v_share public.monthly_shares;
  BEGIN
    IF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor') THEN
      RAISE EXCEPTION 'kin: monthly share refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_me := kin_private.my_member_id(p_circle);
    SELECT * INTO v_share FROM public.monthly_shares WHERE circle_id = p_circle AND id = p_share AND member_id = v_me FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: monthly share refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_share.state = p_state THEN
      RETURN;
    END IF;
    UPDATE public.monthly_shares SET state = p_state WHERE id = p_share AND circle_id = p_circle;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'monthly_share.' || CASE p_state WHEN 'active' THEN 'resumed' WHEN 'paused' THEN 'paused' ELSE 'cancelled' END,
              'monthly_share', p_share, jsonb_build_object('from', v_share.state), 'web');
  END
  $$;

REVOKE ALL ON FUNCTION kin_private.move_my_share(uuid, uuid, public.monthly_share_state) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.move_my_share(uuid, uuid, public.monthly_share_state) TO kin_app;

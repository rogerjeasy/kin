-- Who may read and change a request for money by PayPal invoice
-- (docs/architecture.md section 8.4, "Requests by invoice"), for the table
-- made in 0030.
--
-- Everyone who sees the circle's money reads every request: the member asked
-- to pay sees their own, and the family sees who was asked for what. A
-- caregiver sees none. A person writes nothing directly: an organizer asks,
-- records what PayPal did with the invoice, or withdraws it, through the three
-- functions below, which recheck the role and the seat. What was paid reaches
-- the ledger only through the worker, as the service, once it has read the
-- paid invoice and its capture back from PayPal.
ALTER TABLE public.invoice_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_own_circle ON public.invoice_requests FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id())
  WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY app_member_read ON public.invoice_requests FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));

GRANT SELECT ON public.invoice_requests TO kin_app;
GRANT SELECT, UPDATE ON public.invoice_requests TO kin_service;
--> statement-breakpoint

-- A request only moves along the diagram in packages/domain
-- (INVOICE_REQUEST_TRANSITIONS): requested, then sent, then paid; withdrawn
-- while it waits; failed if PayPal refused it. Late or repeated news from
-- PayPal cannot reopen it, and what was asked of whom never changes.
CREATE FUNCTION kin_private.guard_invoice_request_move() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.circle_id IS DISTINCT FROM OLD.circle_id OR NEW.member_id IS DISTINCT FROM OLD.member_id
       OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.purpose IS DISTINCT FROM OLD.purpose
       OR NEW.period IS DISTINCT FROM OLD.period OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
       OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.simulated IS DISTINCT FROM OLD.simulated
       OR NEW.recipient IS DISTINCT FROM OLD.recipient OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR (OLD.paypal_invoice_id IS NOT NULL AND NEW.paypal_invoice_id IS DISTINCT FROM OLD.paypal_invoice_id)
       OR (OLD.payment_id IS NOT NULL AND NEW.payment_id IS DISTINCT FROM OLD.payment_id) THEN
      RAISE EXCEPTION 'kin: what an invoice request asks of whom cannot change' USING ERRCODE = 'KB015';
    END IF;
    IF NEW.state IS NOT DISTINCT FROM OLD.state THEN
      NEW.updated_at := now();
      RETURN NEW;
    END IF;
    IF NOT (
      (OLD.state = 'requested' AND NEW.state IN ('sent', 'failed', 'cancelled'))
      OR (OLD.state = 'sent' AND NEW.state IN ('paid', 'cancelled'))
    ) THEN
      RAISE EXCEPTION 'kin: a % invoice request cannot become %', OLD.state, NEW.state USING ERRCODE = 'KB015';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END
  $$;

CREATE TRIGGER invoice_request_moves_forward BEFORE UPDATE ON public.invoice_requests
  FOR EACH ROW EXECUTE FUNCTION kin_private.guard_invoice_request_move();
--> statement-breakpoint

-- An organizer asks a member who shares the cost (an organizer or a
-- contributor, never themselves) to pay the pool by PayPal invoice. A
-- settlement request names its period; a top-up request keeps a top-up's
-- limits. The invoice goes to the member's own PayPal email, the one they
-- gave for their settlement payouts, or else the email they verified when
-- they signed in: nobody types where it goes. In a demo circle the member is
-- a stand-in, so the invoice goes to Kin's own sandbox account
-- (`p_demo_recipient`, from the deployment's settings) or, without one, the
-- request is simulated. The row's ID is the request's idempotency key: the
-- same request again returns the row already made.
CREATE FUNCTION kin_private.request_invoice(p_circle uuid, p_id uuid, p_member uuid, p_purpose public.invoice_purpose, p_period text, p_cents bigint, p_demo_recipient text)
  RETURNS public.invoice_requests
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_circle public.circles;
    v_me uuid;
    v_payer public.members;
    v_row public.invoice_requests;
    v_recipient text;
  BEGIN
    IF kin_private.my_role(p_circle) IS DISTINCT FROM 'organizer' THEN
      RAISE EXCEPTION 'kin: invoice request refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_me := kin_private.my_member_id(p_circle);
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    SELECT * INTO v_payer FROM public.members WHERE circle_id = p_circle AND id = p_member AND status = 'active' AND role IN ('organizer', 'contributor');
    IF v_circle.id IS NULL OR v_me IS NULL OR v_payer.id IS NULL OR v_payer.id = v_me THEN
      RAISE EXCEPTION 'kin: invoice request refused' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT * INTO v_row FROM public.invoice_requests WHERE circle_id = p_circle AND id = p_id;
    IF FOUND THEN
      IF v_row.member_id = p_member AND v_row.purpose = p_purpose AND v_row.amount_cents = p_cents AND v_row.period IS NOT DISTINCT FROM p_period THEN
        RETURN v_row;
      END IF;
      RAISE EXCEPTION 'kin: the request key was used for another request' USING ERRCODE = 'check_violation';
    END IF;

    IF (p_purpose = 'settlement') <> (p_period IS NOT NULL) OR (p_period IS NOT NULL AND p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$') THEN
      RAISE EXCEPTION 'kin: invoice request period refused' USING ERRCODE = 'check_violation';
    END IF;
    IF p_cents IS NULL OR p_cents <= 0 OR (p_purpose = 'top_up' AND (v_circle.currency <> 'USD' OR p_cents NOT BETWEEN 100 AND 500000)) THEN
      RAISE EXCEPTION 'kin: invoice request amount refused' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.invoice_requests WHERE circle_id = p_circle AND member_id = p_member AND purpose = p_purpose AND state IN ('requested', 'sent')) THEN
      RAISE EXCEPTION 'kin: this member already has a request waiting' USING ERRCODE = 'KB014';
    END IF;

    IF v_circle.demo THEN
      v_recipient := nullif(lower(trim(coalesce(p_demo_recipient, ''))), '');
    ELSE
      -- A real family's invoice goes only where the member said, never to an address the request names.
      IF p_demo_recipient IS NOT NULL THEN
        RAISE EXCEPTION 'kin: invoice request refused' USING ERRCODE = 'insufficient_privilege';
      END IF;
      SELECT p.paypal_receiver INTO v_recipient FROM public.payees p
        WHERE p.circle_id = p_circle AND p.member_id = p_member AND p.category = 'settlement' AND p.paypal_receiver IS NOT NULL;
      IF v_recipient IS NULL THEN
        SELECT lower(u.email) INTO v_recipient FROM public.users u WHERE u.id = v_payer.user_id AND u.email_verified;
      END IF;
      IF v_recipient IS NULL THEN
        RAISE EXCEPTION 'kin: the member has no PayPal email' USING ERRCODE = 'KB016';
      END IF;
    END IF;
    IF v_recipient IS NOT NULL AND (length(v_recipient) > 254 OR v_recipient !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') THEN
      RAISE EXCEPTION 'kin: invoice recipient refused' USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.invoice_requests (id, circle_id, member_id, requested_by, purpose, period, amount_cents, currency, simulated, recipient)
      VALUES (p_id, p_circle, p_member, v_me, p_purpose, p_period, p_cents, v_circle.currency, v_recipient IS NULL, v_recipient)
      RETURNING * INTO v_row;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'invoice.requested', 'invoice_request', p_id,
              jsonb_build_object('purpose', p_purpose, 'cents', p_cents, 'payer', p_member, 'simulated', v_row.simulated), 'web');
    RETURN v_row;
  END
  $$;

REVOKE ALL ON FUNCTION kin_private.request_invoice(uuid, uuid, uuid, public.invoice_purpose, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.request_invoice(uuid, uuid, uuid, public.invoice_purpose, text, bigint, text) TO kin_app;
--> statement-breakpoint

-- Records that PayPal holds the invoice and emailed it, once Kin has read it
-- back as sent. A simulated request has no PayPal invoice and names none.
-- Saying it again changes nothing.
CREATE FUNCTION kin_private.mark_invoice_sent(p_circle uuid, p_id uuid, p_paypal text, p_number text, p_url text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid;
    v_row public.invoice_requests;
  BEGIN
    IF kin_private.my_role(p_circle) IS DISTINCT FROM 'organizer' THEN
      RAISE EXCEPTION 'kin: invoice request refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_me := kin_private.my_member_id(p_circle);
    SELECT * INTO v_row FROM public.invoice_requests WHERE circle_id = p_circle AND id = p_id FOR UPDATE;
    IF NOT FOUND OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: invoice request refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_row.simulated <> (p_paypal IS NULL)
       OR (p_paypal IS NOT NULL AND (p_paypal !~ '^INV2(-[A-Z0-9]{4}){4}$' OR p_number IS NULL OR p_number !~ '^[A-Za-z0-9-]{1,25}$'
           OR (p_url IS NOT NULL AND (p_url !~ '^https://([a-z0-9-]+\.)*paypal\.com/[^[:space:]]*$' OR length(p_url) > 2000)))) THEN
      RAISE EXCEPTION 'kin: invoice request needs a PayPal invoice' USING ERRCODE = 'check_violation';
    END IF;
    IF v_row.state = 'sent' AND v_row.paypal_invoice_id IS NOT DISTINCT FROM p_paypal THEN
      RETURN;
    END IF;
    UPDATE public.invoice_requests
      SET state = 'sent', paypal_invoice_id = p_paypal, invoice_number = p_number, payer_url = p_url, sent_at = now()
      WHERE circle_id = p_circle AND id = p_id;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'invoice.sent', 'invoice_request', p_id,
              jsonb_build_object('paypal_invoice', p_paypal, 'simulated', v_row.simulated), 'web');
  END
  $$;

REVOKE ALL ON FUNCTION kin_private.mark_invoice_sent(uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.mark_invoice_sent(uuid, uuid, text, text, text) TO kin_app;
--> statement-breakpoint

-- Ends a request an organizer withdrew (`cancelled`, after PayPal cancelled
-- the invoice) or PayPal refused to make or send (`failed`). Only along the
-- diagram, so a paid request is never withdrawn.
CREATE FUNCTION kin_private.close_invoice_request(p_circle uuid, p_id uuid, p_state public.invoice_request_state) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid;
    v_row public.invoice_requests;
  BEGIN
    IF kin_private.my_role(p_circle) IS DISTINCT FROM 'organizer' OR p_state NOT IN ('cancelled', 'failed') THEN
      RAISE EXCEPTION 'kin: invoice request refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_me := kin_private.my_member_id(p_circle);
    SELECT * INTO v_row FROM public.invoice_requests WHERE circle_id = p_circle AND id = p_id FOR UPDATE;
    IF NOT FOUND OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: invoice request refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_row.state = p_state THEN
      RETURN;
    END IF;
    UPDATE public.invoice_requests SET state = p_state WHERE circle_id = p_circle AND id = p_id;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'invoice.' || p_state::text, 'invoice_request', p_id,
              jsonb_build_object('from', v_row.state), 'web');
  END
  $$;

REVOKE ALL ON FUNCTION kin_private.close_invoice_request(uuid, uuid, public.invoice_request_state) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.close_invoice_request(uuid, uuid, public.invoice_request_state) TO kin_app;

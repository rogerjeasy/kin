-- Agency invoices through the same signed API as visits (docs/architecture.md
-- section 13.5, decision 111). Tables agency_invoices and agency_invoice_lines
-- come from the generated migration before this one.
--
-- An invoice pays nothing by itself. Receiving one writes the invoice, its
-- lines and a bill waiting for review, for a payee that is the agency; no
-- proposal, no approval, no execution, no ledger line. A person who shares
-- the cost then reviews the bill with kin_private.review_bill exactly as one
-- read from a letter (migration 0064): the same plan of yeses, the same
-- new-payee rule, the same rule that the reviewer is never the only yes, the
-- same fresh multi-factor check for real money, and the same payout bounded
-- by the pool's confirmed balance. Nothing below loosens any of them; the two
-- triggers on bills and proposals only refuse or relabel.
--
-- Refusals that screens and the API word, by SQLSTATE:
--   42501  the person may not do this, or the key is not live
--   KA004  the agency sent this invoice number before with a different body
--   KA005  the key sent more invoices today than an agency ever needs
--   KB018  a reviewer asked to pay more than the agency invoiced
ALTER TABLE public.agency_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_invoiced_visits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Like every circle table: the service acts for the circle it names, and the
-- provisioner fills the circle it is creating. Whoever sees the circle's money
-- reads its invoices and their lines; a caregiver and an observer who does
-- not see the money read none.
CREATE POLICY service_own_circle ON public.agency_invoices FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY service_own_circle ON public.agency_invoice_lines FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY provisioner_new_circle ON public.agency_invoices FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
CREATE POLICY provisioner_new_circle ON public.agency_invoice_lines FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
CREATE POLICY app_member_read ON public.agency_invoices FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));
CREATE POLICY app_member_read ON public.agency_invoice_lines FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));
CREATE POLICY service_own_circle ON public.agency_invoiced_visits FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY provisioner_new_circle ON public.agency_invoiced_visits FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
CREATE POLICY app_member_read ON public.agency_invoiced_visits FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));
--> statement-breakpoint

-- No person's role reads the raw body the agency sent; the service may, as
-- the evidence it is. Only the operations below write.
GRANT SELECT (id, circle_id, agency_key_id, body_sha256, state, refusal, invoice_number, period_start, period_end, total_cents, currency, due_on,
  paypal_email, bill_id, seeded, received_at) ON public.agency_invoices TO kin_app;
GRANT SELECT ON public.agency_invoices TO kin_service;
GRANT SELECT ON public.agency_invoice_lines, public.agency_invoiced_visits TO kin_app, kin_service;
GRANT INSERT ON public.agency_invoices, public.agency_invoice_lines, public.agency_invoiced_visits TO kin_provisioner;
--> statement-breakpoint

-- An invoice and its lines are never changed or deleted: the status the
-- agency reads is the bill's and its payment's.
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON public.agency_invoices
  FOR EACH ROW EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON public.agency_invoices
  FOR EACH STATEMENT EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON public.agency_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON public.agency_invoice_lines
  FOR EACH STATEMENT EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER no_delete BEFORE DELETE ON public.agency_invoiced_visits
  FOR EACH ROW EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER no_delete_truncate BEFORE TRUNCATE ON public.agency_invoiced_visits
  FOR EACH STATEMENT EXECUTE FUNCTION kin_private.refuse_change();
--> statement-breakpoint

-- Which invoice holds a visit never changes; it is released once, when the
-- family declines the invoice, and never taken back.
CREATE FUNCTION kin_private.assert_claim_released_once() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF (to_jsonb(NEW) - 'released_at') IS DISTINCT FROM (to_jsonb(OLD) - 'released_at') OR OLD.released_at IS NOT NULL OR NEW.released_at IS NULL THEN
      RAISE EXCEPTION 'kin: agency_invoiced_visits % is only ever released, once', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint
CREATE TRIGGER released_once BEFORE UPDATE ON public.agency_invoiced_visits
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_claim_released_once();
--> statement-breakpoint

-- A reviewer may pay an agency less than it invoiced (only the visits the
-- family stands behind), never more: whatever writes a bill's amount, an
-- invoiced bill stays at or below the invoice's total.
CREATE FUNCTION kin_private.assert_within_invoice() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM public.agency_invoices i WHERE i.circle_id = NEW.circle_id AND i.bill_id = NEW.id AND NEW.amount_cents > i.total_cents) THEN
      RAISE EXCEPTION 'kin: bill % would pay more than the agency invoiced', NEW.id USING ERRCODE = 'KB018';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint
CREATE TRIGGER within_invoice BEFORE UPDATE OF amount_cents ON public.bills
  FOR EACH ROW WHEN (NEW.amount_cents IS DISTINCT FROM OLD.amount_cents)
  EXECUTE FUNCTION kin_private.assert_within_invoice();
--> statement-breakpoint

-- A payment raised from an invoiced bill says so, so the approval card words
-- it as an agency's invoice and not as a letter. Only the label changes.
CREATE FUNCTION kin_private.label_invoice_payment() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM public.agency_invoices i WHERE i.circle_id = NEW.circle_id AND i.bill_id = NEW.bill_id) THEN
      NEW.purpose := 'agency_invoice';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint
CREATE TRIGGER label_invoice_payment BEFORE INSERT ON public.proposals
  FOR EACH ROW WHEN (NEW.kind = 'bill_payment' AND NEW.purpose = 'letter_bill' AND NEW.bill_id IS NOT NULL)
  EXECUTE FUNCTION kin_private.label_invoice_payment();
--> statement-breakpoint

-- Keeps one invoice an agency sent, for the live key whose ID and secret hash
-- the web app verified the signature with. Open to kin_app with nobody signed
-- in. The raw body is kept as it arrived; `p_invoice` is the domain's parsed
-- invoice (its total already recomputed from the lines), or null with
-- `p_refusal` when the body was not one. The same invoice number with the
-- same body returns the invoice already kept; with another body it is
-- refused. Every line must be a visit this agency reported to this circle (each is locked for the rest of the transaction),
-- under this key or another of the circle's keys with the same name, and on
-- no other live invoice (agency_invoiced_visits); otherwise the body is kept as
-- refused, with why. Written: the invoice, its lines, the agency as a new
-- payee with no PayPal address the first time, and a bill waiting for
-- review. Nothing else: no proposal, no approval, no payment.
CREATE FUNCTION kin_private.receive_agency_invoice(p_key_id text, p_secret_hash text, p_raw text, p_invoice jsonb, p_refusal text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_key public.agency_keys;
    v_circle public.circles;
    v_sha text := encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
    v_id uuid := gen_random_uuid();
    v_existing public.agency_invoices;
    v_line jsonb;
    v_position integer := 0;
    v_visit uuid;
    v_unknown text[] := ARRAY[]::text[];
    v_invoiced text[] := ARRAY[]::text[];
    v_visits uuid[] := ARRAY[]::uuid[];
    v_payee uuid;
    v_bill uuid := gen_random_uuid();
    v_refusal text;
  BEGIN
    SELECT k.* INTO v_key FROM public.agency_keys k JOIN public.circles c ON c.id = k.circle_id AND c.status = 'active'
      WHERE k.key_id = p_key_id AND k.secret_hash = p_secret_hash AND k.revoked_at IS NULL FOR UPDATE OF k;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: this agency key is not live' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = v_key.circle_id;
    IF (SELECT count(*) FROM public.agency_invoices WHERE agency_key_id = v_key.id AND received_at > now() - interval '1 day') >= 200 THEN
      RAISE EXCEPTION 'kin: too many invoices sent today' USING ERRCODE = 'KA005';
    END IF;
    UPDATE public.agency_keys SET last_used_at = now() WHERE id = v_key.id;

    IF p_invoice IS NOT NULL THEN
      SELECT * INTO v_existing FROM public.agency_invoices WHERE agency_key_id = v_key.id AND invoice_number = p_invoice ->> 'invoiceNumber';
      IF FOUND THEN
        IF v_existing.body_sha256 = v_sha THEN
          RETURN jsonb_build_object('id', v_existing.id, 'state', 'accepted', 'duplicate', true, 'billId', v_existing.bill_id);
        END IF;
        RAISE EXCEPTION 'kin: this invoice number was sent before with another body' USING ERRCODE = 'KA004';
      END IF;
      IF p_invoice ->> 'currency' IS DISTINCT FROM v_circle.currency::text THEN
        v_refusal := 'circle_currency';
      ELSE
        FOR v_line IN SELECT value FROM jsonb_array_elements(p_invoice -> 'lines') LOOP
          SELECT r.id INTO v_visit FROM public.agency_visit_reports r JOIN public.agency_keys k ON k.circle_id = r.circle_id AND k.id = r.agency_key_id
            WHERE r.circle_id = v_key.circle_id AND r.state = 'accepted' AND r.external_id = v_line ->> 'visitId'
              AND (k.id = v_key.id OR lower(btrim(k.label)) = lower(btrim(v_key.label)))
            ORDER BY (k.id = v_key.id) DESC, r.received_at DESC LIMIT 1
            -- Held until this transaction ends, so a second invoice for the same visit, under any key, waits and then sees this one.
            FOR UPDATE OF r;
          IF v_visit IS NULL THEN
            v_unknown := v_unknown || (v_line ->> 'visitId');
          ELSIF EXISTS (SELECT 1 FROM public.agency_invoiced_visits c WHERE c.circle_id = v_key.circle_id AND c.visit_report_id = v_visit AND c.released_at IS NULL) THEN
            v_invoiced := v_invoiced || (v_line ->> 'visitId');
          END IF;
          v_visits := v_visits || v_visit;
        END LOOP;
        v_refusal := CASE WHEN cardinality(v_unknown) > 0 THEN 'unknown_visit' WHEN cardinality(v_invoiced) > 0 THEN 'visit_invoiced' END;
      END IF;
    ELSE
      v_refusal := p_refusal;
    END IF;

    IF v_refusal IS NOT NULL THEN
      INSERT INTO public.agency_invoices (id, circle_id, agency_key_id, raw_body, body_sha256, state, refusal)
        VALUES (v_id, v_key.circle_id, v_key.id, p_raw, v_sha, 'refused', v_refusal);
      RETURN jsonb_build_object('id', v_id, 'state', 'refused', 'refusal', v_refusal, 'duplicate', false,
        'visits', to_jsonb(CASE WHEN v_refusal = 'unknown_visit' THEN v_unknown ELSE v_invoiced END));
    END IF;

    -- The money core's own check, a second time: the lines add up to the total in integer cents.
    IF (SELECT sum((l ->> 'amountCents')::numeric) FROM jsonb_array_elements(p_invoice -> 'lines') l) IS DISTINCT FROM (p_invoice ->> 'totalCents')::numeric THEN
      RAISE EXCEPTION 'kin: the invoice lines do not add up to its total' USING ERRCODE = 'check_violation';
    END IF;

    -- The agency is paid as a company the family pays: the payee an earlier invoice from this agency made, or a
    -- new one. Never another payee that merely shares the key's name, so a key can never reach a payee the family
    -- approved, its address or its standing rule.
    SELECT b.payee_id INTO v_payee FROM public.agency_invoices i
      JOIN public.agency_keys k ON k.circle_id = i.circle_id AND k.id = i.agency_key_id
      JOIN public.bills b ON b.circle_id = i.circle_id AND b.id = i.bill_id
      WHERE i.circle_id = v_key.circle_id AND i.state = 'accepted' AND (k.id = v_key.id OR lower(btrim(k.label)) = lower(btrim(v_key.label)))
      ORDER BY i.received_at, i.id LIMIT 1;
    IF v_payee IS NULL THEN
      v_payee := gen_random_uuid();
      INSERT INTO public.payees (id, circle_id, name, category, status) VALUES (v_payee, v_key.circle_id, btrim(v_key.label), 'care', 'new');
    END IF;
    INSERT INTO public.bills (id, circle_id, payee_id, amount_cents, due_on, received_on)
      VALUES (v_bill, v_key.circle_id, v_payee, (p_invoice ->> 'totalCents')::bigint, (p_invoice ->> 'dueOn')::date,
              (coalesce(v_circle.clock_at, now()) AT TIME ZONE v_circle.timezone)::date);
    UPDATE public.bills SET state = 'extracted' WHERE circle_id = v_key.circle_id AND id = v_bill;
    UPDATE public.bills SET state = 'needs_review' WHERE circle_id = v_key.circle_id AND id = v_bill;
    INSERT INTO public.agency_invoices (id, circle_id, agency_key_id, raw_body, body_sha256, state, invoice_number, period_start, period_end,
        total_cents, currency, due_on, paypal_email, bill_id)
      VALUES (v_id, v_key.circle_id, v_key.id, p_raw, v_sha, 'accepted', p_invoice ->> 'invoiceNumber', (p_invoice ->> 'periodStart')::date,
        (p_invoice ->> 'periodEnd')::date, (p_invoice ->> 'totalCents')::bigint, p_invoice ->> 'currency', (p_invoice ->> 'dueOn')::date,
        lower(p_invoice ->> 'paypalEmail'), v_bill);
    FOR v_line IN SELECT value FROM jsonb_array_elements(p_invoice -> 'lines') LOOP
      v_position := v_position + 1;
      INSERT INTO public.agency_invoice_lines (id, circle_id, invoice_id, position, visit_report_id, minutes, amount_cents)
        VALUES (gen_random_uuid(), v_key.circle_id, v_id, v_position, v_visits[v_position], (v_line ->> 'minutes')::integer, (v_line ->> 'amountCents')::bigint);
      -- The unique index on live claims refuses a second invoice for this visit even if every check above were skipped.
      INSERT INTO public.agency_invoiced_visits (id, circle_id, visit_report_id, invoice_id)
        VALUES (gen_random_uuid(), v_key.circle_id, v_visits[v_position], v_id);
    END LOOP;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), v_key.circle_id, 'service', NULL, 'agency.invoice_received', 'agency_invoice', v_id,
        jsonb_build_object('invoiceNumber', p_invoice ->> 'invoiceNumber', 'billId', v_bill, 'cents', (p_invoice ->> 'totalCents')::bigint), 'agency:' || v_key.key_id);
    RETURN jsonb_build_object('id', v_id, 'state', 'accepted', 'duplicate', false, 'billId', v_bill);
  END
  $$;
--> statement-breakpoint

-- Where an invoice stands, for the agency whose live key sent it, and nothing
-- about the family beyond it: AGENCY_INVOICE_STATUSES in packages/domain,
-- the total, and the payout's state once Kin has asked PayPal to pay. PayPal's
-- item status is named only when PayPal confirmed a real payout. Open to
-- kin_app with nobody signed in; an unknown number returns null.
CREATE FUNCTION kin_private.agency_invoice_status(p_key_id text, p_secret_hash text, p_number text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_key public.agency_keys;
    v_invoice public.agency_invoices;
    v_bill public.bills;
    v_proposal public.proposals;
    v_execution public.executions;
    v_simulated boolean;
    v_status text;
    v_payout jsonb := 'null'::jsonb;
  BEGIN
    SELECT k.* INTO v_key FROM public.agency_keys k JOIN public.circles c ON c.id = k.circle_id AND c.status = 'active'
      WHERE k.key_id = p_key_id AND k.secret_hash = p_secret_hash AND k.revoked_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: this agency key is not live' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_invoice FROM public.agency_invoices WHERE agency_key_id = v_key.id AND invoice_number = p_number AND state = 'accepted';
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    SELECT * INTO v_bill FROM public.bills WHERE circle_id = v_invoice.circle_id AND id = v_invoice.bill_id;
    SELECT * INTO v_proposal FROM public.proposals WHERE circle_id = v_invoice.circle_id AND bill_id = v_bill.id ORDER BY raised_at DESC, id DESC LIMIT 1;
    IF v_proposal.id IS NOT NULL THEN
      SELECT * INTO v_execution FROM public.executions WHERE circle_id = v_invoice.circle_id AND proposal_id = v_proposal.id;
    END IF;
    v_status := CASE
      WHEN v_bill.state = 'rejected' THEN 'declined'
      WHEN v_bill.state = 'paid' THEN 'paid'
      WHEN v_bill.state = 'ready' THEN 'approved'
      WHEN v_bill.state = 'proposed' AND v_proposal.state = 'pending_approval' THEN 'under_review'
      WHEN v_bill.state = 'proposed' AND v_proposal.state IN ('approved', 'executing', 'failed', 'settled') THEN 'approved'
      WHEN v_bill.state = 'proposed' AND v_proposal.state = 'rejected' THEN 'declined'
      ELSE 'received'
    END;
    IF v_execution.id IS NOT NULL THEN
      SELECT e.simulated INTO v_simulated FROM public.ledger_entries e
        WHERE e.circle_id = v_invoice.circle_id AND e.source_type = 'paypal_event' AND e.source_id = v_execution.paypal_item_id LIMIT 1;
      v_payout := jsonb_build_object('state', v_execution.state::text,
        'paypalItemStatus', CASE WHEN v_execution.state = 'confirmed' AND v_simulated IS FALSE THEN 'SUCCESS' END,
        'simulated', coalesce(v_simulated, (SELECT c.demo FROM public.circles c WHERE c.id = v_invoice.circle_id)));
    END IF;
    RETURN jsonb_build_object('invoiceNumber', v_invoice.invoice_number, 'status', v_status, 'totalCents', v_invoice.total_cents,
      'currency', v_invoice.currency, 'receivedAt', v_invoice.received_at, 'payout', v_payout);
  END
  $$;
--> statement-breakpoint

-- A member who shares the cost declines an invoice still waiting for review:
-- the family does not owe it. The bill closes as rejected and the agency's
-- status reads declined. Its visits may then be invoiced again.
CREATE FUNCTION kin_private.decline_agency_invoice(p_circle uuid, p_bill uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_member uuid := kin_private.my_member_id(p_circle);
    v_bill public.bills;
  BEGIN
    IF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor') THEN
      RAISE EXCEPTION 'kin: declining an invoice refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT b.* INTO v_bill FROM public.bills b JOIN public.circles c ON c.id = b.circle_id AND c.status = 'active'
      WHERE b.circle_id = p_circle AND b.id = p_bill
        AND EXISTS (SELECT 1 FROM public.agency_invoices i WHERE i.circle_id = b.circle_id AND i.bill_id = b.id)
      FOR UPDATE OF b;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: declining an invoice refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_bill.state = 'rejected' THEN
      RETURN false;
    END IF;
    IF v_bill.state <> 'needs_review' THEN
      RAISE EXCEPTION 'kin: the invoice is not waiting for review' USING ERRCODE = 'KB005';
    END IF;
    UPDATE public.bills SET state = 'rejected' WHERE circle_id = p_circle AND id = p_bill;
    UPDATE public.agency_invoiced_visits c SET released_at = now()
      FROM public.agency_invoices i
      WHERE i.circle_id = p_circle AND i.bill_id = p_bill AND c.circle_id = p_circle AND c.invoice_id = i.id AND c.released_at IS NULL;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_member, 'agency.invoice_declined', 'bill', p_bill, '{}'::jsonb, 'web');
    RETURN true;
  END
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.assert_within_invoice() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.label_invoice_payment() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.assert_claim_released_once() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.receive_agency_invoice(text, text, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.agency_invoice_status(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.decline_agency_invoice(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.receive_agency_invoice(text, text, text, jsonb, text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.agency_invoice_status(text, text, text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.decline_agency_invoice(uuid, uuid) TO kin_app;

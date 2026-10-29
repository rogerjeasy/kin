ALTER TABLE "executions" ADD COLUMN "receiver" text;--> statement-breakpoint

-- Where a payout goes is fixed on the execution: copied from the payee when
-- the family's approval queues it, or, when the caregiver had not yet given
-- one, filled once by the worker before anything is sent. After that it
-- never changes, so a later change of the payee's address cannot move money
-- the family already approved, even on a retry after a failure.
CREATE OR REPLACE FUNCTION kin_private.queue_payout() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_execution uuid := gen_random_uuid();
  BEGIN
    INSERT INTO public.executions (id, circle_id, proposal_id, idempotency_key, state, receiver)
      VALUES (v_execution, NEW.circle_id, NEW.id, 'kin-payout-' || NEW.id::text, 'created',
              (SELECT paypal_receiver FROM public.payees WHERE circle_id = NEW.circle_id AND id = NEW.payee_id));
    INSERT INTO public.outbox (id, circle_id, topic, payload)
      VALUES (gen_random_uuid(), NEW.circle_id, 'payout.execute', jsonb_build_object('executionId', v_execution));
    RETURN NEW;
  END
  $$;

CREATE FUNCTION kin_private.assert_receiver_fixed() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF OLD.receiver IS NOT NULL AND NEW.receiver IS DISTINCT FROM OLD.receiver THEN
      RAISE EXCEPTION 'kin: execution % already pays %, and cannot be pointed elsewhere', OLD.id, OLD.receiver
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER receiver_fixed BEFORE UPDATE OF receiver ON public.executions
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_receiver_fixed();
--> statement-breakpoint

-- The address is held for the whole life of a payment to the caregiver,
-- including a failed one that may be tried again.
CREATE OR REPLACE FUNCTION kin_private.set_own_receiver(p_circle uuid, p_email text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_email text := lower(trim(coalesce(p_email, '')));
    v_member uuid;
    v_payee public.payees;
  BEGIN
    IF kin_private.my_role(p_circle) IS DISTINCT FROM 'caregiver' THEN
      RAISE EXCEPTION 'kin: caregiver receiver refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_member := kin_private.my_member_id(p_circle);
    SELECT * INTO v_payee FROM public.payees
      WHERE circle_id = p_circle AND member_id = v_member AND caregiver_rate_cents_per_hour IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: no caregiver rate' USING ERRCODE = 'KB001';
    END IF;
    IF length(v_email) > 127 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
      RAISE EXCEPTION 'kin: invalid PayPal email' USING ERRCODE = 'check_violation';
    END IF;
    IF v_payee.paypal_receiver IS NOT DISTINCT FROM v_email THEN
      RETURN;
    END IF;
    IF v_payee.paypal_receiver IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.proposals
      WHERE circle_id = p_circle AND payee_id = v_payee.id
        AND state IN ('proposed', 'pending_approval', 'approved', 'executing', 'failed')
    ) THEN
      RAISE EXCEPTION 'kin: a payment to this caregiver is in progress' USING ERRCODE = 'KB009';
    END IF;
    UPDATE public.payees SET paypal_receiver = v_email WHERE id = v_payee.id AND circle_id = p_circle;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_member, 'caregiver_receiver.set', 'payee', v_payee.id,
              jsonb_build_object('replaced', v_payee.paypal_receiver IS NOT NULL), 'web');
  END
  $$;

REVOKE ALL ON FUNCTION kin_private.assert_receiver_fixed() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.queue_payout() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.set_own_receiver(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.set_own_receiver(uuid, text) TO kin_app;

-- Paying an approved caregiver payout (docs/architecture.md section 7.6).
--
-- In the same transaction that a proposal becomes approved, Kin creates its
-- execution, with the idempotency key PayPal will see as the batch ID, and an
-- outbox row that tells the worker to carry it out. A person's approval
-- therefore can never be lost between the database and the worker, and
-- nobody but Kin's service moves the execution on.
CREATE FUNCTION kin_private.queue_payout() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_execution uuid := gen_random_uuid();
  BEGIN
    INSERT INTO public.executions (id, circle_id, proposal_id, idempotency_key, state)
      VALUES (v_execution, NEW.circle_id, NEW.id, 'kin-payout-' || NEW.id::text, 'created');
    INSERT INTO public.outbox (id, circle_id, topic, payload)
      VALUES (gen_random_uuid(), NEW.circle_id, 'payout.execute', jsonb_build_object('executionId', v_execution));
    RETURN NEW;
  END
  $$;

CREATE TRIGGER queue_payout AFTER UPDATE OF state ON public.proposals
  FOR EACH ROW
  WHEN (OLD.state = 'pending_approval' AND NEW.state = 'approved' AND NEW.kind = 'caregiver_payout')
  EXECUTE FUNCTION kin_private.queue_payout();

-- One execution per proposal's first attempt: the key is the proposal's own.
CREATE UNIQUE INDEX executions_one_per_proposal ON public.executions (circle_id, proposal_id);
--> statement-breakpoint

-- The worker's lease on the outbox. Rows of every circle are read here, so
-- only Kin's service may call it, and it returns no more than the worker
-- needs to open each circle's own scope: the row, its circle and its message.
-- A claimed row is hidden for the lease; the worker marks it sent, or makes
-- it available again later, inside the circle's scope.
CREATE FUNCTION kin_private.claim_outbox(p_topic text, p_limit integer, p_lease_seconds integer)
  RETURNS TABLE (id uuid, circle_id uuid, payload jsonb, attempts integer)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF session_user <> 'kin_service' THEN
      RAISE EXCEPTION 'kin: only Kin''s service reads the outbox' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_limit NOT BETWEEN 1 AND 100 OR p_lease_seconds NOT BETWEEN 10 AND 3600 THEN
      RAISE EXCEPTION 'kin: an outbox lease of % rows for % seconds is out of range', p_limit, p_lease_seconds USING ERRCODE = 'check_violation';
    END IF;
    RETURN QUERY
      WITH claimed AS (
        SELECT o.id FROM public.outbox o
        WHERE o.topic = p_topic AND o.sent_at IS NULL AND o.available_at <= now()
        ORDER BY o.available_at, o.created_at
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
      )
      UPDATE public.outbox o
        SET available_at = now() + make_interval(secs => p_lease_seconds), attempts = o.attempts + 1
        FROM claimed WHERE o.id = claimed.id
        RETURNING o.id, o.circle_id, o.payload, o.attempts;
  END
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.queue_payout() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.claim_outbox(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.claim_outbox(text, integer, integer) TO kin_service;
--> statement-breakpoint

-- Where a caregiver's pay goes: their PayPal email, recorded by an organizer.
-- It cannot change while a payment to them is approved or being paid, so no
-- one can redirect money that the family has already said yes to. The
-- address itself is not copied into the audit log.
CREATE FUNCTION kin_private.set_caregiver_receiver(p_circle uuid, p_payee uuid, p_email text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_email text := lower(trim(coalesce(p_email, '')));
  BEGIN
    IF NOT coalesce(kin_private.is_organizer(p_circle), false) THEN
      RAISE EXCEPTION 'kin: caregiver receiver refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM 1 FROM public.payees p JOIN public.members m ON m.circle_id = p.circle_id AND m.id = p.member_id
      WHERE p.circle_id = p_circle AND p.id = p_payee AND m.role = 'caregiver' AND m.status = 'active' FOR UPDATE OF p;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: caregiver receiver refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF length(v_email) > 127 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
      RAISE EXCEPTION 'kin: invalid PayPal email' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.proposals WHERE circle_id = p_circle AND payee_id = p_payee AND state IN ('approved', 'executing')) THEN
      RAISE EXCEPTION 'kin: a payment to this caregiver is in progress' USING ERRCODE = 'KB009';
    END IF;
    UPDATE public.payees SET paypal_receiver = v_email WHERE id = p_payee AND circle_id = p_circle AND paypal_receiver IS DISTINCT FROM v_email;
    IF FOUND THEN
      INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, origin)
        VALUES (gen_random_uuid(), p_circle, 'member', kin_private.my_member_id(p_circle), 'caregiver_receiver.set', 'payee', p_payee, 'web');
    END IF;
  END
  $$;

REVOKE ALL ON FUNCTION kin_private.set_caregiver_receiver(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.set_caregiver_receiver(uuid, uuid, text) TO kin_app;

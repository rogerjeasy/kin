-- Who says where a caregiver's pay goes: the caregiver, and nobody else.
--
-- 0008 let an organizer record the address, so an organizer could send a
-- caregiver's approved pay to an account of their own; and the address could
-- change while the family was still being asked to approve. Now only the
-- caregiver records their own PayPal email, for their own payee. Once one is
-- recorded, it cannot change while a payment to them waits for approval, is
-- approved or is being paid, so the family approves the destination it saw.
-- A first address can be added at any time: it redirects nothing.
DROP FUNCTION kin_private.set_caregiver_receiver(uuid, uuid, text);

CREATE FUNCTION kin_private.set_own_receiver(p_circle uuid, p_email text) RETURNS void
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
      WHERE circle_id = p_circle AND payee_id = v_payee.id AND state IN ('pending_approval', 'approved', 'executing')
    ) THEN
      RAISE EXCEPTION 'kin: a payment to this caregiver is in progress' USING ERRCODE = 'KB009';
    END IF;
    UPDATE public.payees SET paypal_receiver = v_email WHERE id = v_payee.id AND circle_id = p_circle;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_member, 'caregiver_receiver.set', 'payee', v_payee.id,
              jsonb_build_object('replaced', v_payee.paypal_receiver IS NOT NULL), 'web');
  END
  $$;

REVOKE ALL ON FUNCTION kin_private.set_own_receiver(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.set_own_receiver(uuid, text) TO kin_app;

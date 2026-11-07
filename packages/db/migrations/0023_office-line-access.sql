-- The family office line's record of a call (docs/feature-proposals.md section 2).
--
-- A call's verdict is reached by plain code in the app. These rules only
-- keep the record: the service reads and writes it for its own circle, the
-- members who see the circle's money read it, and a call is recorded through
-- one operation that also raises the claim check and tells the family.
ALTER TABLE public.office_calls ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY service_own_circle ON public.office_calls FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id())
  WITH CHECK (circle_id = kin_private.circle_id());

CREATE POLICY app_member_read ON public.office_calls FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));

GRANT SELECT ON public.office_calls TO kin_app;
GRANT SELECT, INSERT ON public.office_calls TO kin_service;
--> statement-breakpoint

-- Records a call, the claim check it produced and the alert to every member
-- who sees the circle's money, in one step. The organizer, contributors and
-- the parent may; a caregiver or an observer may not. Returns both IDs.
CREATE FUNCTION kin_private.record_office_call(
  p_circle uuid, p_number text, p_caller text, p_org text, p_claimed bigint, p_purpose text, p_reference text,
  p_transcript jsonb, p_signals text[], p_simulated boolean,
  p_payee uuid, p_found uuid, p_verdict public.claim_verdict, p_topic text, p_spoken text, p_claim text
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_circle public.circles;
    v_member uuid := kin_private.my_member_id(p_circle);
    v_today date;
    v_check uuid;
    v_call uuid := gen_random_uuid();
  BEGIN
    IF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor', 'parent') THEN
      RAISE EXCEPTION 'kin: office line refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: office line refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- A call placed from the simulator is simulated; a real circle's call is never labelled as one.
    IF jsonb_typeof(p_transcript) IS DISTINCT FROM 'array' OR jsonb_array_length(p_transcript) > 60
       OR (p_number IS NOT NULL AND length(p_number) > 32)
       OR (p_caller IS NOT NULL AND length(p_caller) > 200) OR (p_org IS NOT NULL AND length(p_org) > 200)
       OR (p_purpose IS NOT NULL AND length(p_purpose) > 200) OR (p_reference IS NOT NULL AND length(p_reference) > 200)
       OR (p_claimed IS NOT NULL AND p_claimed <= 0) THEN
      RAISE EXCEPTION 'kin: the call is not valid' USING ERRCODE = 'check_violation';
    END IF;
    v_today := (coalesce(v_circle.clock_at, now()) AT TIME ZONE v_circle.timezone)::date;

    v_check := kin_private.record_claim_check(p_circle, p_payee, p_claimed, p_claim, p_found, p_verdict, p_topic, p_spoken);
    INSERT INTO public.office_calls (id, circle_id, caller_number, caller_name, organization, claimed_cents, purpose, reference,
                                     transcript, verdict, pressure_signals, simulated, claim_check_id, called_on)
      VALUES (v_call, p_circle, p_number, p_caller, p_org, p_claimed, p_purpose, p_reference,
              p_transcript, p_verdict, coalesce(p_signals, '{}'), p_simulated OR v_circle.demo, v_check, v_today);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_member, 'office_call.recorded', 'office_call', v_call,
              jsonb_build_object('verdict', p_verdict, 'simulated', p_simulated OR v_circle.demo), 'web');
    RETURN jsonb_build_object('callId', v_call, 'claimCheckId', v_check);
  END
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.record_office_call(uuid, text, text, text, bigint, text, text, jsonb, text[], boolean, uuid, uuid, public.claim_verdict, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.record_office_call(uuid, text, text, text, bigint, text, text, jsonb, text[], boolean, uuid, uuid, public.claim_verdict, text, text, text) TO kin_app;

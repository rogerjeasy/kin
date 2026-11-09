-- A scam sign for money sent through a payment app to an account the caller
-- names (PayPal.me, Venmo, Zelle, Cash App, a $cashtag). The domain finds it
-- (SCAM_MARKERS in packages/domain/src/presence-check.ts); the database takes
-- it among the markers a check may hold. Nothing else in the function changes.

CREATE OR REPLACE FUNCTION kin_private.insert_presence_check(
  p_circle uuid, p_source text, p_call_sid text, p_opened_by uuid, p_voice uuid,
  p_name text, p_relationship text, p_cents bigint, p_markers text[], p_said text[], p_locale text, p_token text, p_alerts jsonb
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_circle public.circles;
    v_voice public.trusted_voices;
    v_existing public.presence_checks;
    v_id uuid := gen_random_uuid();
    v_state text;
    v_simulated boolean;
    v_said text;
    v_key text;
  BEGIN
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: presence checks refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_call_sid IS NOT NULL THEN
      SELECT * INTO v_existing FROM public.presence_checks WHERE circle_id = p_circle AND call_sid = p_call_sid;
      IF FOUND THEN
        RETURN jsonb_build_object('checkId', v_existing.id, 'state', v_existing.state, 'simulated', v_existing.simulated, 'repeated', true);
      END IF;
    END IF;
    IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' OR p_locale NOT IN ('en', 'fr', 'de', 'it', 'es', 'ar', 'he')
       OR coalesce(cardinality(p_said), 0) NOT BETWEEN 1 AND 12 OR (p_cents IS NOT NULL AND p_cents <= 0)
       OR NOT (coalesce(p_markers, '{}') <@ ARRAY['secrecy', 'urgency', 'gift_cards', 'crypto_atm', 'courier_pickup', 'wire', 'payment_app'])
       OR (p_name IS NOT NULL AND length(p_name) > 80) OR (p_relationship IS NOT NULL AND length(p_relationship) > 80)
       OR jsonb_typeof(p_alerts) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'kin: the presence check is not valid' USING ERRCODE = 'check_violation';
    END IF;
    FOREACH v_said IN ARRAY p_said LOOP
      IF length(v_said) > 1200 THEN
        RAISE EXCEPTION 'kin: the presence check is not valid' USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
    FOREACH v_key IN ARRAY ARRAY['denied', 'unreachable', 'confirmed', 'unknown'] LOOP
      IF jsonb_typeof(p_alerts -> v_key) IS DISTINCT FROM 'string' OR length(p_alerts ->> v_key) NOT BETWEEN 1 AND 600 THEN
        RAISE EXCEPTION 'kin: the presence check is not valid' USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
    IF (SELECT count(*) FROM public.presence_checks WHERE circle_id = p_circle AND created_at > now() - interval '1 hour') >= 6 THEN
      RAISE EXCEPTION 'kin: too many checks this hour' USING ERRCODE = 'KP001';
    END IF;
    IF p_voice IS NOT NULL THEN
      SELECT * INTO v_voice FROM public.trusted_voices
        WHERE circle_id = p_circle AND id = p_voice AND removed_at IS NULL AND confirmed_at IS NOT NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'kin: that person cannot be asked' USING ERRCODE = 'KP002';
      END IF;
    END IF;

    v_simulated := v_circle.demo OR coalesce(v_voice.simulated, false);
    v_state := CASE WHEN p_voice IS NULL THEN 'unanswered' WHEN v_simulated THEN 'asked' ELSE 'opened' END;
    INSERT INTO public.presence_checks (id, circle_id, source, call_sid, opened_by, voice_id, claimed_name, claimed_relationship, claimed_cents,
                                        markers, said, state, locale, token_hash, asked_at, expires_at, hold_until, alerts, simulated)
      VALUES (v_id, p_circle, p_source, p_call_sid, p_opened_by, p_voice, nullif(btrim(p_name), ''), nullif(btrim(p_relationship), ''), p_cents,
              coalesce(p_markers, '{}'), p_said, 'opened', p_locale, encode(sha256(convert_to(p_token, 'UTF8')), 'hex'), NULL,
              now() + interval '15 minutes',
              CASE WHEN p_voice IS NULL THEN NULL ELSE now() + interval '15 minutes' END, p_alerts, v_simulated);
    IF v_state = 'asked' THEN
      UPDATE public.presence_checks SET state = 'asked', asked_at = now() WHERE id = v_id;
    ELSIF v_state = 'unanswered' THEN
      UPDATE public.presence_checks SET state = 'unanswered' WHERE id = v_id;
      PERFORM kin_private.raise_presence_alert(p_circle, v_id, 'no_match', 'falseDemand', p_cents, p_alerts ->> 'unknown',
                                               coalesce(nullif(btrim(p_name), ''), 'Unknown caller') || ': claimed to be family');
    ELSE
      INSERT INTO public.outbox (id, circle_id, topic, payload)
        VALUES (gen_random_uuid(), p_circle, 'presence.ask', jsonb_build_object('checkId', v_id, 'token', p_token));
    END IF;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, CASE WHEN p_opened_by IS NULL THEN 'service'::public.audit_actor ELSE 'member'::public.audit_actor END,
              p_opened_by, 'presence_check.opened', 'presence_check', v_id,
              jsonb_build_object('state', v_state, 'simulated', v_simulated, 'markers', coalesce(p_markers, '{}'), 'asked', p_voice IS NOT NULL),
              CASE WHEN p_source = 'phone' THEN 'call' ELSE 'web' END);
    RETURN jsonb_build_object('checkId', v_id, 'state', v_state, 'simulated', v_simulated, 'repeated', false);
  END
  $$;

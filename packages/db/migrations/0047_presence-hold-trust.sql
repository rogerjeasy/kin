-- Who may freeze the pool, kept on the check itself (`may_hold`), not worked out again later.
--   * A check a signed-in member opened, and one opened by a call from the parent's own number, may hold outgoing money,
--     while it is open and for a day after the real person says "not me".
--   * Any other caller's check on the phone line never may, whatever the real person later answers: it still asks them
--     and tells the family, but a stranger cannot freeze the pool, not even by getting a confused relative to tap "no".
--   * The hourly limits are counted apart: three for strangers, six for the parent's number, so a stranger cannot use up the
--     parent's calls.
CREATE OR REPLACE FUNCTION kin_private.assert_presence_fixed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_open text[] := ARRAY['state', 'asked_at', 'ask_message_sid', 'answered_at', 'answered_via', 'hold_until', 'call_attempted_at', 'ask_call_sid', 'help_proposal_id', 'code_attempts', 'may_hold'];
  BEGIN
    IF (to_jsonb(NEW) - v_open) IS DISTINCT FROM (to_jsonb(OLD) - v_open)
       OR (OLD.help_proposal_id IS NOT NULL AND NEW.help_proposal_id IS DISTINCT FROM OLD.help_proposal_id)
       OR (OLD.ask_call_sid IS NOT NULL AND NEW.ask_call_sid IS DISTINCT FROM OLD.ask_call_sid)
       OR NEW.code_attempts < OLD.code_attempts
       OR (NOT OLD.may_hold AND NEW.may_hold) THEN
      RAISE EXCEPTION 'kin: a presence check cannot change after it is opened, only move through its states'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION kin_private.apply_presence_answer(p_check uuid, p_answer text, p_via text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_check public.presence_checks;
    v_circle public.circles;
    v_target text;
    v_name text;
  BEGIN
    SELECT * INTO v_check FROM public.presence_checks WHERE id = p_check FOR UPDATE;
    SELECT * INTO v_circle FROM public.circles WHERE id = v_check.circle_id AND status = 'active';
    IF v_check.id IS NULL OR v_circle.id IS NULL OR v_check.voice_id IS NULL OR v_check.expires_at <= now() THEN
      RAISE EXCEPTION 'kin: link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_target := CASE p_answer WHEN 'me' THEN 'confirmed' ELSE 'denied' END;
    IF v_check.state = v_target THEN
      RETURN jsonb_build_object('state', v_check.state, 'changed', false);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM kin_private.state_transitions WHERE machine = 'presence' AND from_state = v_check.state AND to_state = v_target) THEN
      RAISE EXCEPTION 'kin: that check cannot take this answer' USING ERRCODE = 'KP003';
    END IF;
    UPDATE public.presence_checks
      SET state = v_target, answered_at = now(), answered_via = p_via, asked_at = coalesce(asked_at, now()),
          hold_until = CASE WHEN v_target = 'denied' AND v_check.may_hold THEN now() + interval '24 hours' ELSE NULL END
      WHERE id = v_check.id;
    SELECT split_part(btrim(name), ' ', 1) INTO v_name FROM public.trusted_voices WHERE circle_id = v_check.circle_id AND id = v_check.voice_id;
    IF v_target = 'denied' THEN
      PERFORM kin_private.raise_presence_alert(v_check.circle_id, v_check.id, 'no_match', 'falseDemand', v_check.claimed_cents, v_check.alerts ->> 'denied',
                                               v_name || ': says it was not them');
    ELSE
      PERFORM kin_private.raise_presence_alert(v_check.circle_id, v_check.id, 'unclear', 'claimUnclear', v_check.claimed_cents, v_check.alerts ->> 'confirmed',
                                               v_name || ': says it was them');
    END IF;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), v_check.circle_id, 'service', NULL, 'presence_check.answered', 'presence_check', v_check.id,
              jsonb_build_object('answer', p_answer, 'from', v_check.state, 'via', p_via), p_via);
    RETURN jsonb_build_object('state', v_target, 'changed', true);
  END
  $$;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION kin_private.open_presence_check_by_line(
  p_circle uuid, p_call_sid text, p_voice uuid, p_name text, p_relationship text, p_cents bigint, p_markers text[], p_said text[],
  p_locale text, p_token text, p_alerts jsonb, p_from text
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_result jsonb;
    v_parent text;
    v_from_parent boolean;
    v_limit integer;
  BEGIN
    IF session_user <> 'kin_service' OR kin_private.circle_id() IS DISTINCT FROM p_circle OR p_call_sid IS NULL OR p_call_sid !~ '^[A-Za-z0-9]{1,64}$' THEN
      RAISE EXCEPTION 'kin: presence checks refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT phone INTO v_parent FROM public.parent_call_settings WHERE circle_id = p_circle;
    v_from_parent := v_parent IS NOT NULL AND p_from IS NOT NULL AND p_from = v_parent;
    v_limit := CASE WHEN v_from_parent THEN 6 ELSE 3 END;
    IF NOT EXISTS (SELECT 1 FROM public.presence_checks WHERE circle_id = p_circle AND call_sid = p_call_sid)
       AND (SELECT count(*) FROM public.presence_checks WHERE circle_id = p_circle AND source = 'phone' AND may_hold = v_from_parent AND created_at > now() - interval '1 hour') >= v_limit THEN
      RAISE EXCEPTION 'kin: too many calls this hour' USING ERRCODE = 'KP001';
    END IF;
    v_result := kin_private.insert_presence_check(p_circle, 'phone', p_call_sid, NULL, p_voice, p_name, p_relationship,
                                                  p_cents, p_markers, p_said, p_locale, p_token, p_alerts);
    IF NOT v_from_parent AND coalesce((v_result ->> 'repeated')::boolean, false) = false THEN
      UPDATE public.presence_checks SET hold_until = NULL, may_hold = false WHERE circle_id = p_circle AND id = (v_result ->> 'checkId')::uuid;
    END IF;
    RETURN v_result || jsonb_build_object('fromParent', v_from_parent);
  END
  $$;

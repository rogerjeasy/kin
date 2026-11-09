-- The presence line is a public phone number, so what an unidentified caller can make it do is bounded.
--   * A check opened over the phone holds outgoing money only when the caller ID is the parent's registered number
--     (parent_call_settings.phone). Anyone else's call still asks the real person and tells the family, but cannot freeze
--     the pool. Caller ID can be forged, but only by someone who knows both Kin's private number and the parent's.
--   * The line opens at most three checks an hour (the screen's six an hour stands for signed-in members).
--   * The weekly family code can be put to a check's caller twice, by the screen or the phone, and no more.
CREATE OR REPLACE FUNCTION kin_private.assert_presence_fixed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_open text[] := ARRAY['state', 'asked_at', 'ask_message_sid', 'answered_at', 'answered_via', 'hold_until', 'call_attempted_at', 'ask_call_sid', 'help_proposal_id', 'code_attempts'];
  BEGIN
    IF (to_jsonb(NEW) - v_open) IS DISTINCT FROM (to_jsonb(OLD) - v_open)
       OR (OLD.help_proposal_id IS NOT NULL AND NEW.help_proposal_id IS DISTINCT FROM OLD.help_proposal_id)
       OR (OLD.ask_call_sid IS NOT NULL AND NEW.ask_call_sid IS DISTINCT FROM OLD.ask_call_sid)
       OR NEW.code_attempts < OLD.code_attempts THEN
      RAISE EXCEPTION 'kin: a presence check cannot change after it is opened, only move through its states'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

GRANT SELECT (code_attempts) ON public.presence_checks TO kin_app;
--> statement-breakpoint

DROP FUNCTION kin_private.open_presence_check_by_line(uuid, text, uuid, text, text, bigint, text[], text[], text, text, jsonb);
--> statement-breakpoint

-- Kin's phone service opens a check for a call to the number of one circle, as 0040 did, with the caller ID it was given.
-- `fromParent` in the answer says whether that is the parent's registered number; only then does the check hold money.
CREATE FUNCTION kin_private.open_presence_check_by_line(
  p_circle uuid, p_call_sid text, p_voice uuid, p_name text, p_relationship text, p_cents bigint, p_markers text[], p_said text[],
  p_locale text, p_token text, p_alerts jsonb, p_from text
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_result jsonb;
    v_parent text;
    v_from_parent boolean;
  BEGIN
    IF session_user <> 'kin_service' OR kin_private.circle_id() IS DISTINCT FROM p_circle OR p_call_sid IS NULL OR p_call_sid !~ '^[A-Za-z0-9]{1,64}$' THEN
      RAISE EXCEPTION 'kin: presence checks refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.presence_checks WHERE circle_id = p_circle AND call_sid = p_call_sid)
       AND (SELECT count(*) FROM public.presence_checks WHERE circle_id = p_circle AND source = 'phone' AND created_at > now() - interval '1 hour') >= 3 THEN
      RAISE EXCEPTION 'kin: too many calls this hour' USING ERRCODE = 'KP001';
    END IF;
    SELECT phone INTO v_parent FROM public.parent_call_settings WHERE circle_id = p_circle;
    v_from_parent := v_parent IS NOT NULL AND p_from IS NOT NULL AND p_from = v_parent;
    v_result := kin_private.insert_presence_check(p_circle, 'phone', p_call_sid, NULL, p_voice, p_name, p_relationship,
                                                  p_cents, p_markers, p_said, p_locale, p_token, p_alerts);
    IF NOT v_from_parent AND coalesce((v_result ->> 'repeated')::boolean, false) = false THEN
      UPDATE public.presence_checks SET hold_until = NULL WHERE circle_id = p_circle AND id = (v_result ->> 'checkId')::uuid;
    END IF;
    RETURN v_result || jsonb_build_object('fromParent', v_from_parent);
  END
  $$;
--> statement-breakpoint

-- Counts one try at the weekly family code against a check and says whether it may be made: two a check, whoever asks
-- (a member through the screen, or Kin's service for the line's circle). The comparison itself is plain code in the app.
CREATE FUNCTION kin_private.use_code_attempt(p_circle uuid, p_check uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF session_user = 'kin_service' THEN
      IF kin_private.circle_id() IS DISTINCT FROM p_circle THEN
        RAISE EXCEPTION 'kin: the family code is refused' USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor', 'parent') THEN
      RAISE EXCEPTION 'kin: the family code is refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE public.presence_checks SET code_attempts = code_attempts + 1 WHERE circle_id = p_circle AND id = p_check AND code_attempts < 2;
    IF FOUND THEN
      RETURN true;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.presence_checks WHERE circle_id = p_circle AND id = p_check) THEN
      RAISE EXCEPTION 'kin: the family code is refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN false;
  END
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.open_presence_check_by_line(uuid, text, uuid, text, text, bigint, text[], text[], text, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.use_code_attempt(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.open_presence_check_by_line(uuid, text, uuid, text, text, bigint, text[], text[], text, text, jsonb, text) TO kin_service;
GRANT EXECUTE ON FUNCTION kin_private.use_code_attempt(uuid, uuid) TO kin_app, kin_service;

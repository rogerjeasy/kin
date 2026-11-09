-- "Is it really you?": trusted family voices and presence checks, with their access.
--
-- The parent was pressed for money by a voice that says it is family and asks
-- Kin. Plain code in the app reads what she said, finds the claimed person on
-- the family's list of trusted voices and scores the scam markers. These rules
-- only keep the record and move it forward:
--   * the family's trusted voices are added, confirmed from the person's own
--     phone, and removed through operations that check the role;
--   * a check is opened by a member, or by Kin's phone service for the one
--     circle its number belongs to, and never changed in what it records;
--   * the real person answers from a link with nobody signed in: the link is a
--     bearer token and the database keeps only its SHA-256;
--   * while a check is open, and for a day after a "not me", outgoing money is
--     held (readPayoutJob reads `hold_until`), without touching the pause switch
--     a person pressed.
-- A link that cannot be used for any reason is refused with 42501 and one
-- message, so a refusal never says whether a token exists.
ALTER TABLE public.trusted_voices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence_checks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY service_own_circle ON public.trusted_voices FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY service_own_circle ON public.presence_checks FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY provisioner_new_circle ON public.trusted_voices FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
-- Whoever sees the circle's money sees who Kin may ask and how each check went. Nobody but the service sees a phone number or a link's hash.
CREATE POLICY app_member_read ON public.trusted_voices FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id) AND removed_at IS NULL);
CREATE POLICY app_member_read ON public.presence_checks FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));
--> statement-breakpoint

GRANT SELECT (id, circle_id, name, relationship, locale, confirmed_at, added_by, simulated, removed_at, created_at) ON public.trusted_voices TO kin_app;
GRANT SELECT (id, circle_id, source, opened_by, voice_id, claimed_name, claimed_relationship, claimed_cents, markers, said, state, locale, asked_at, expires_at, answered_at, hold_until, alerts, simulated, created_at)
  ON public.presence_checks TO kin_app;
GRANT SELECT ON public.trusted_voices, public.presence_checks TO kin_service;
GRANT INSERT ON public.trusted_voices TO kin_provisioner;
--> statement-breakpoint

-- A check moves along the diagram in packages/domain (PRESENCE_TRANSITIONS), held
-- to it by a test. A late "not me" can follow an unanswered check or a mistaken
-- "yes", because it only ever makes Kin more careful; a "yes" never follows a "no".
INSERT INTO kin_private.state_transitions (machine, from_state, to_state) VALUES
  ('presence', 'opened', 'asked'),
  ('presence', 'opened', 'unanswered'),
  ('presence', 'opened', 'expired'),
  ('presence', 'asked', 'confirmed'),
  ('presence', 'asked', 'denied'),
  ('presence', 'asked', 'unanswered'),
  ('presence', 'asked', 'expired'),
  ('presence', 'unanswered', 'confirmed'),
  ('presence', 'unanswered', 'denied'),
  ('presence', 'unanswered', 'expired'),
  ('presence', 'confirmed', 'denied');
--> statement-breakpoint

CREATE TRIGGER state_moves_forward BEFORE UPDATE OF state ON public.presence_checks
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_transition('presence');
--> statement-breakpoint

-- What a check records about the call never changes: only how it ended, when, and the hold.
CREATE FUNCTION kin_private.assert_presence_fixed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF (to_jsonb(NEW) - ARRAY['state', 'asked_at', 'ask_message_sid', 'answered_at', 'hold_until'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state', 'asked_at', 'ask_message_sid', 'answered_at', 'hold_until']) THEN
      RAISE EXCEPTION 'kin: a presence check cannot change after it is opened, only move through its states'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

CREATE TRIGGER presence_fixed BEFORE UPDATE ON public.presence_checks
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_presence_fixed();
--> statement-breakpoint

-- The family's alert for a finished or unfinished check: a claim check and one
-- narration for every member who sees the circle's money, exactly as the office
-- line raises them. Internal: no role may call it, only the operations below.
CREATE FUNCTION kin_private.raise_presence_alert(
  p_circle uuid, p_check uuid, p_verdict public.claim_verdict, p_topic text, p_cents bigint, p_spoken text, p_claim text
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_circle public.circles;
    v_today date;
    v_alerted uuid[];
    v_id uuid := gen_random_uuid();
    v_told uuid;
  BEGIN
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    IF NOT FOUND OR p_spoken IS NULL OR length(p_spoken) NOT BETWEEN 1 AND 600 OR length(btrim(p_claim)) NOT BETWEEN 1 AND 500 THEN
      RAISE EXCEPTION 'kin: the alert is not valid' USING ERRCODE = 'check_violation';
    END IF;
    v_today := (coalesce(v_circle.clock_at, now()) AT TIME ZONE v_circle.timezone)::date;
    SELECT coalesce(array_agg(id ORDER BY joined_at, id), '{}') INTO v_alerted FROM public.members
      WHERE circle_id = p_circle AND status = 'active' AND role IN ('organizer', 'contributor', 'parent', 'observer');
    INSERT INTO public.claim_checks (id, circle_id, checked_on, payee_id, claimed_cents, claim, found_entry_id, verdict, alerted)
      VALUES (v_id, p_circle, v_today, NULL, p_cents, btrim(p_claim), NULL, p_verdict, v_alerted);
    FOREACH v_told IN ARRAY v_alerted LOOP
      INSERT INTO public.narrations (id, circle_id, member_id, topic, cents, claim_check_id, spoken_text, state, said_on)
        VALUES (gen_random_uuid(), p_circle, v_told, p_topic, p_cents, v_id, p_spoken, 'queued', v_today);
    END LOOP;
    RETURN v_id;
  END
  $$;
--> statement-breakpoint

-- Adds a family member Kin may ask. The organizer or the parent. Their phone is
-- confirmed by a text with a link (the token's hash is kept for a week); in a
-- demo circle the stand-in is confirmed at once and nothing is texted.
CREATE FUNCTION kin_private.add_trusted_voice(
  p_circle uuid, p_name text, p_relationship text, p_phone text, p_locale text, p_token text
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_circle public.circles;
    v_member uuid := kin_private.my_member_id(p_circle);
    v_id uuid := gen_random_uuid();
  BEGIN
    IF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'parent') THEN
      RAISE EXCEPTION 'kin: trusted voices refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: trusted voices refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' OR p_phone !~ '^\+[1-9][0-9]{6,14}$'
       OR p_locale NOT IN ('en', 'fr', 'de', 'it', 'es', 'ar', 'he')
       OR length(btrim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 80 OR length(btrim(coalesce(p_relationship, ''))) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'kin: the trusted voice is not valid' USING ERRCODE = 'check_violation';
    END IF;
    IF (SELECT count(*) FROM public.trusted_voices WHERE circle_id = p_circle AND removed_at IS NULL) >= 12 THEN
      RAISE EXCEPTION 'kin: a circle may trust at most twelve voices' USING ERRCODE = 'KP004';
    END IF;
    IF EXISTS (SELECT 1 FROM public.trusted_voices WHERE circle_id = p_circle AND phone = p_phone AND removed_at IS NULL) THEN
      RAISE EXCEPTION 'kin: that number is already on the list' USING ERRCODE = 'unique_violation';
    END IF;
    IF v_circle.demo THEN
      INSERT INTO public.trusted_voices (id, circle_id, name, relationship, phone, locale, confirmed_at, added_by, simulated)
        VALUES (v_id, p_circle, btrim(p_name), btrim(p_relationship), p_phone, p_locale, now(), v_member, true);
    ELSE
      INSERT INTO public.trusted_voices (id, circle_id, name, relationship, phone, locale, confirm_token_hash, confirm_expires_at, added_by)
        VALUES (v_id, p_circle, btrim(p_name), btrim(p_relationship), p_phone, p_locale,
                encode(sha256(convert_to(p_token, 'UTF8')), 'hex'), now() + interval '7 days', v_member);
      INSERT INTO public.outbox (id, circle_id, topic, payload)
        VALUES (gen_random_uuid(), p_circle, 'presence.confirm', jsonb_build_object('voiceId', v_id, 'token', p_token));
    END IF;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_member, 'trusted_voice.added', 'trusted_voice', v_id,
              jsonb_build_object('simulated', v_circle.demo), 'web');
    RETURN jsonb_build_object('id', v_id, 'simulated', v_circle.demo, 'confirmed', v_circle.demo);
  END
  $$;
--> statement-breakpoint

CREATE FUNCTION kin_private.remove_trusted_voice(p_circle uuid, p_voice uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'parent') THEN
      RAISE EXCEPTION 'kin: trusted voices refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE public.trusted_voices SET removed_at = now(), confirm_token_hash = NULL
      WHERE circle_id = p_circle AND id = p_voice AND removed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: trusted voices refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', kin_private.my_member_id(p_circle), 'trusted_voice.removed', 'trusted_voice', p_voice, 'web');
  END
  $$;
--> statement-breakpoint

-- The page a family member opens from the confirmation text: whose circle asks
-- them to be a trusted voice. It changes nothing and names no ID.
CREATE FUNCTION kin_private.trusted_voice_status(p_token text) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_voice public.trusted_voices;
    v_parent text;
    v_circle public.circles;
  BEGIN
    IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
      RAISE EXCEPTION 'kin: link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_voice FROM public.trusted_voices
      WHERE confirm_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') AND removed_at IS NULL;
    SELECT * INTO v_circle FROM public.circles WHERE id = v_voice.circle_id AND status = 'active';
    IF v_voice.id IS NULL OR v_circle.id IS NULL OR v_voice.confirm_expires_at <= now() THEN
      RAISE EXCEPTION 'kin: link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT split_part(btrim(display_name), ' ', 1) INTO v_parent FROM public.members
      WHERE circle_id = v_voice.circle_id AND role = 'parent' AND status = 'active' ORDER BY joined_at LIMIT 1;
    RETURN jsonb_build_object('name', split_part(btrim(v_voice.name), ' ', 1), 'parentFirstName', coalesce(v_parent, ''), 'confirmed', v_voice.confirmed_at IS NOT NULL);
  END
  $$;
--> statement-breakpoint

-- The person taps "yes, this is my number": the voice is confirmed and the link
-- is spent. Run with nobody signed in.
CREATE FUNCTION kin_private.confirm_trusted_voice(p_token text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_voice public.trusted_voices;
    v_parent text;
    v_circle public.circles;
  BEGIN
    IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
      RAISE EXCEPTION 'kin: link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_voice FROM public.trusted_voices
      WHERE confirm_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') AND removed_at IS NULL FOR UPDATE;
    SELECT * INTO v_circle FROM public.circles WHERE id = v_voice.circle_id AND status = 'active';
    IF v_voice.id IS NULL OR v_circle.id IS NULL OR v_voice.confirm_expires_at <= now() THEN
      RAISE EXCEPTION 'kin: link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_voice.confirmed_at IS NULL THEN
      UPDATE public.trusted_voices SET confirmed_at = now(), confirm_token_hash = NULL, confirm_expires_at = NULL WHERE id = v_voice.id;
      INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, origin)
        VALUES (gen_random_uuid(), v_voice.circle_id, 'service', NULL, 'trusted_voice.confirmed', 'trusted_voice', v_voice.id, 'link');
    END IF;
    SELECT split_part(btrim(display_name), ' ', 1) INTO v_parent FROM public.members
      WHERE circle_id = v_voice.circle_id AND role = 'parent' AND status = 'active' ORDER BY joined_at LIMIT 1;
    RETURN jsonb_build_object('name', split_part(btrim(v_voice.name), ' ', 1), 'parentFirstName', coalesce(v_parent, ''), 'confirmed', true);
  END
  $$;
--> statement-breakpoint

-- Opens a check. Shared by the member's and the phone line's entry points below;
-- it trusts neither, so each of them checks who is calling first.
--   * `p_voice` is the trusted person plain code matched the claim to, or null
--     when nobody on the list fits: then nobody can be asked, the check is
--     `unanswered` at once, and the family is told so.
--   * `p_alerts` holds the family's words for each ending (`denied`,
--     `unreachable`, `confirmed`, `unknown`), worded from the record by code.
--   * In a demo circle, or for a stand-in voice, no text is sent: the check is
--     `asked` at once and the screen shows what the person's phone would show.
--   * Otherwise it is `opened` and a `presence.ask` message carries the token
--     to the worker, which texts the person and strips the token again.
--   * A circle may open six checks an hour: each one texts a real person.
--   * A phone call is recorded once, however often Twilio delivers it.
CREATE FUNCTION kin_private.insert_presence_check(
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
       OR NOT (coalesce(p_markers, '{}') <@ ARRAY['secrecy', 'urgency', 'gift_cards', 'crypto_atm', 'courier_pickup', 'wire'])
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
--> statement-breakpoint

-- A member tells Kin what a caller who said they were family asked for. The
-- organizer, a contributor or the parent; never a caregiver or an observer.
CREATE FUNCTION kin_private.open_presence_check(
  p_circle uuid, p_voice uuid, p_name text, p_relationship text, p_cents bigint, p_markers text[], p_said text[],
  p_locale text, p_token text, p_alerts jsonb
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor', 'parent') THEN
      RAISE EXCEPTION 'kin: presence checks refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN kin_private.insert_presence_check(p_circle, 'app', NULL, kin_private.my_member_id(p_circle), p_voice, p_name, p_relationship,
                                             p_cents, p_markers, p_said, p_locale, p_token, p_alerts);
  END
  $$;
--> statement-breakpoint

-- Kin's phone service opens a check for a call to the number of one circle. As
-- Kin's service only, for the circle it names: any other circle is refused.
CREATE FUNCTION kin_private.open_presence_check_by_line(
  p_circle uuid, p_call_sid text, p_voice uuid, p_name text, p_relationship text, p_cents bigint, p_markers text[], p_said text[],
  p_locale text, p_token text, p_alerts jsonb
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF session_user <> 'kin_service' OR kin_private.circle_id() IS DISTINCT FROM p_circle OR p_call_sid IS NULL OR p_call_sid !~ '^[A-Za-z0-9]{1,64}$' THEN
      RAISE EXCEPTION 'kin: presence checks refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN kin_private.insert_presence_check(p_circle, 'phone', p_call_sid, NULL, p_voice, p_name, p_relationship,
                                             p_cents, p_markers, p_said, p_locale, p_token, p_alerts);
  END
  $$;
--> statement-breakpoint

-- What the real person's page may say before any tap: their first name, the
-- parent's, the amount, and whether the answer still counts. It names no ID,
-- changes nothing and counts nothing (the web app slows it per address, as it
-- does the check-in link).
CREATE FUNCTION kin_private.presence_check_status(p_token text) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_check public.presence_checks;
    v_voice public.trusted_voices;
    v_circle public.circles;
    v_parent text;
  BEGIN
    IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
      RAISE EXCEPTION 'kin: link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_check FROM public.presence_checks WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
    SELECT * INTO v_circle FROM public.circles WHERE id = v_check.circle_id AND status = 'active';
    SELECT * INTO v_voice FROM public.trusted_voices WHERE circle_id = v_check.circle_id AND id = v_check.voice_id;
    IF v_check.id IS NULL OR v_circle.id IS NULL OR v_voice.id IS NULL THEN
      RAISE EXCEPTION 'kin: link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT split_part(btrim(display_name), ' ', 1) INTO v_parent FROM public.members
      WHERE circle_id = v_check.circle_id AND role = 'parent' AND status = 'active' ORDER BY joined_at LIMIT 1;
    RETURN jsonb_build_object(
      'state', v_check.state, 'voiceFirstName', split_part(btrim(v_voice.name), ' ', 1), 'parentFirstName', coalesce(v_parent, ''),
      'claimedCents', v_check.claimed_cents, 'currency', v_circle.currency, 'timezone', v_circle.timezone,
      'simulated', v_check.simulated, 'locale', v_voice.locale,
      'canAnswer', v_check.expires_at > now() AND v_check.state IN ('asked', 'unanswered', 'confirmed'));
  END
  $$;
--> statement-breakpoint

-- The real person answers: "yes, it is me" or "no, it is not me". Run with
-- nobody signed in; the link is the credential.
--   * "not me" holds outgoing money for a day and tells the family;
--   * "me" lifts the hold this check made and tells the family that nothing has
--     moved: money still needs the family's approval and goes only to the
--     person's own confirmed account;
--   * the same answer twice changes nothing; a "yes" after a "no" is refused.
CREATE FUNCTION kin_private.answer_presence_check(p_token text, p_answer text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_check public.presence_checks;
    v_circle public.circles;
    v_target text;
    v_name text;
  BEGIN
    IF p_answer IS NULL OR p_answer NOT IN ('me', 'not_me') OR p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
      RAISE EXCEPTION 'kin: link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_check FROM public.presence_checks WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') FOR UPDATE;
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
      SET state = v_target, answered_at = now(), asked_at = coalesce(asked_at, now()),
          hold_until = CASE WHEN v_target = 'denied' THEN now() + interval '24 hours' ELSE NULL END
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
              jsonb_build_object('answer', p_answer, 'from', v_check.state), 'link');
    RETURN jsonb_build_object('state', v_target, 'changed', true);
  END
  $$;
--> statement-breakpoint

-- The worker has texted the person: the check is `asked`, the message is
-- remembered, and the token is stripped from the outbox so no row keeps a link.
-- A check that is already past `opened` (the person answered, or the window ran
-- out first) keeps its state.
CREATE FUNCTION kin_private.record_presence_asked(p_circle uuid, p_check uuid, p_sid text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF session_user <> 'kin_service' OR kin_private.circle_id() IS DISTINCT FROM p_circle OR p_sid !~ '^(SM|MM)[0-9a-fA-F]{32}$' THEN
      RAISE EXCEPTION 'kin: presence checks refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE public.presence_checks
      SET state = CASE WHEN state = 'opened' THEN 'asked' ELSE state END, asked_at = coalesce(asked_at, now()), ask_message_sid = p_sid
      WHERE circle_id = p_circle AND id = p_check;
    UPDATE public.outbox SET payload = payload - 'token'
      WHERE circle_id = p_circle AND topic = 'presence.ask' AND payload ->> 'checkId' = p_check::text;
  END
  $$;
--> statement-breakpoint

-- The worker has texted the confirmation link to a family member's phone.
CREATE FUNCTION kin_private.record_voice_confirm_sent(p_circle uuid, p_voice uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF session_user <> 'kin_service' OR kin_private.circle_id() IS DISTINCT FROM p_circle THEN
      RAISE EXCEPTION 'kin: trusted voices refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE public.outbox SET payload = payload - 'token'
      WHERE circle_id = p_circle AND topic = 'presence.confirm' AND payload ->> 'voiceId' = p_voice::text;
  END
  $$;
--> statement-breakpoint

-- Moves the checks whose time has run out: nobody answered within 90 seconds
-- (`unanswered`, and the family is told Kin could not reach them), or the link
-- itself ran out (`expired`, and the hold this check made is released). Across
-- circles, as Kin's service only. Returns how many it moved.
CREATE FUNCTION kin_private.sweep_presence_checks() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_check public.presence_checks;
    v_name text;
    v_moved integer := 0;
  BEGIN
    IF session_user <> 'kin_service' THEN
      RAISE EXCEPTION 'kin: only Kin''s service sweeps presence checks' USING ERRCODE = 'insufficient_privilege';
    END IF;
    FOR v_check IN
      SELECT * FROM public.presence_checks
        WHERE state IN ('opened', 'asked') AND expires_at > now() AND coalesce(asked_at, created_at) <= now() - interval '90 seconds'
        ORDER BY created_at FOR UPDATE SKIP LOCKED
    LOOP
      UPDATE public.presence_checks SET state = 'unanswered' WHERE id = v_check.id;
      SELECT split_part(btrim(name), ' ', 1) INTO v_name FROM public.trusted_voices WHERE circle_id = v_check.circle_id AND id = v_check.voice_id;
      PERFORM kin_private.raise_presence_alert(v_check.circle_id, v_check.id, 'unclear', 'claimUnclear', v_check.claimed_cents, v_check.alerts ->> 'unreachable',
                                               coalesce(v_name, 'Family') || ': could not be reached');
      INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
        VALUES (gen_random_uuid(), v_check.circle_id, 'service', NULL, 'presence_check.unanswered', 'presence_check', v_check.id, '{}'::jsonb, 'worker');
      v_moved := v_moved + 1;
    END LOOP;
    FOR v_check IN
      SELECT * FROM public.presence_checks
        WHERE state IN ('opened', 'asked', 'unanswered') AND expires_at <= now()
        ORDER BY created_at FOR UPDATE SKIP LOCKED
    LOOP
      UPDATE public.presence_checks SET state = 'expired', hold_until = NULL WHERE id = v_check.id;
      v_moved := v_moved + 1;
    END LOOP;
    RETURN v_moved;
  END
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.raise_presence_alert(uuid, uuid, public.claim_verdict, text, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.insert_presence_check(uuid, text, text, uuid, uuid, text, text, bigint, text[], text[], text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.add_trusted_voice(uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.remove_trusted_voice(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.trusted_voice_status(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.confirm_trusted_voice(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.open_presence_check(uuid, uuid, text, text, bigint, text[], text[], text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.open_presence_check_by_line(uuid, text, uuid, text, text, bigint, text[], text[], text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.presence_check_status(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.answer_presence_check(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.record_presence_asked(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.record_voice_confirm_sent(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.sweep_presence_checks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.add_trusted_voice(uuid, text, text, text, text, text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.remove_trusted_voice(uuid, uuid) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.trusted_voice_status(text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.confirm_trusted_voice(text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.open_presence_check(uuid, uuid, text, text, bigint, text[], text[], text, text, jsonb) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.open_presence_check_by_line(uuid, text, uuid, text, text, bigint, text[], text[], text, text, jsonb) TO kin_service;
GRANT EXECUTE ON FUNCTION kin_private.presence_check_status(text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.answer_presence_check(text, text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.record_presence_asked(uuid, uuid, text) TO kin_service;
GRANT EXECUTE ON FUNCTION kin_private.record_voice_confirm_sent(uuid, uuid) TO kin_service;
GRANT EXECUTE ON FUNCTION kin_private.sweep_presence_checks() TO kin_service;

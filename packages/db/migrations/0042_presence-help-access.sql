-- "Is it really you?", the rest of it: other spellings of a name, Kin's call to the real person, the weekly
-- family code, and help that can go only to the account the real person confirmed.
--
-- Everything here is added to what 0040 made. Nothing a person could do before is loosened.
ALTER TABLE public.family_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- The seed of a family code is a secret of the family's: no role of the web app reads the table, and the
-- operation that hands the seed to a member checks who asks.
CREATE POLICY service_own_circle ON public.family_codes FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
GRANT SELECT ON public.family_codes TO kin_service;
-- What the app may see of the new columns: the other spellings, whether a payout account is confirmed (never which), how a check was answered.
GRANT SELECT (aliases, receiver_confirmed_at) ON public.trusted_voices TO kin_app;
GRANT SELECT (answered_via, help_proposal_id) ON public.presence_checks TO kin_app;
--> statement-breakpoint

ALTER TABLE public.payees ADD CONSTRAINT payees_voice_fk FOREIGN KEY (circle_id, voice_id) REFERENCES public.trusted_voices (circle_id, id);
ALTER TABLE public.presence_checks ADD CONSTRAINT presence_checks_help_fk FOREIGN KEY (circle_id, help_proposal_id) REFERENCES public.proposals (circle_id, id);
CREATE UNIQUE INDEX payees_one_per_voice ON public.payees (circle_id, voice_id) WHERE voice_id IS NOT NULL;
CREATE UNIQUE INDEX presence_checks_one_help ON public.presence_checks (help_proposal_id) WHERE help_proposal_id IS NOT NULL;
--> statement-breakpoint

-- Help for a family member can go to one place only: the account that person confirmed from their own phone.
-- Whatever writes a payee, this holds: a payee of the 'family_help' category is exactly a payee tied to a trusted
-- voice, and its address is that voice's confirmed account, in the PayPal wallet, with no member and no rate.
-- Nobody, not even Kin's own service, can point it anywhere else, and a payee cannot be turned into one later.
CREATE FUNCTION kin_private.assert_help_payee() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_voice public.trusted_voices;
  BEGIN
    IF (NEW.category = 'family_help') <> (NEW.voice_id IS NOT NULL) THEN
      RAISE EXCEPTION 'kin: a family help payee is a trusted voice, and only that' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.voice_id IS DISTINCT FROM NEW.voice_id THEN
      RAISE EXCEPTION 'kin: a payee cannot change who it is' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.voice_id IS NOT NULL THEN
      SELECT * INTO v_voice FROM public.trusted_voices WHERE circle_id = NEW.circle_id AND id = NEW.voice_id;
      IF NOT FOUND OR v_voice.confirmed_at IS NULL OR v_voice.removed_at IS NOT NULL OR v_voice.paypal_receiver IS NULL
         OR NEW.paypal_receiver IS DISTINCT FROM v_voice.paypal_receiver OR NEW.member_id IS NOT NULL
         OR NEW.payout_wallet <> 'paypal' OR NEW.caregiver_rate_cents_per_hour IS NOT NULL THEN
        RAISE EXCEPTION 'kin: help can go only to the account the person confirmed' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

CREATE TRIGGER help_payee_rules BEFORE INSERT OR UPDATE ON public.payees
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_help_payee();
--> statement-breakpoint

-- A check's record never changes after it opens except how it ended, when, the hold, Kin's call and the help raised.
CREATE OR REPLACE FUNCTION kin_private.assert_presence_fixed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_open text[] := ARRAY['state', 'asked_at', 'ask_message_sid', 'answered_at', 'answered_via', 'hold_until', 'call_attempted_at', 'ask_call_sid', 'help_proposal_id'];
  BEGIN
    IF (to_jsonb(NEW) - v_open) IS DISTINCT FROM (to_jsonb(OLD) - v_open)
       OR (OLD.help_proposal_id IS NOT NULL AND NEW.help_proposal_id IS DISTINCT FROM OLD.help_proposal_id)
       OR (OLD.ask_call_sid IS NOT NULL AND NEW.ask_call_sid IS DISTINCT FROM OLD.ask_call_sid) THEN
      RAISE EXCEPTION 'kin: a presence check cannot change after it is opened, only move through its states'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Trusted voices: other spellings, and a confirmed account
-- ---------------------------------------------------------------------------

DROP FUNCTION kin_private.add_trusted_voice(uuid, text, text, text, text, text);
--> statement-breakpoint

-- Adds a family member Kin may ask, as 0040 did, with the other ways the family writes or says the name.
CREATE FUNCTION kin_private.add_trusted_voice(
  p_circle uuid, p_name text, p_relationship text, p_phone text, p_locale text, p_token text, p_aliases text[]
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_circle public.circles;
    v_member uuid := kin_private.my_member_id(p_circle);
    v_id uuid := gen_random_uuid();
    v_aliases text[] := '{}';
    v_alias text;
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
       OR length(btrim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 80 OR length(btrim(coalesce(p_relationship, ''))) NOT BETWEEN 1 AND 80
       OR coalesce(cardinality(p_aliases), 0) > 5 THEN
      RAISE EXCEPTION 'kin: the trusted voice is not valid' USING ERRCODE = 'check_violation';
    END IF;
    FOREACH v_alias IN ARRAY coalesce(p_aliases, '{}') LOOP
      IF length(btrim(v_alias)) NOT BETWEEN 1 AND 80 THEN
        RAISE EXCEPTION 'kin: the trusted voice is not valid' USING ERRCODE = 'check_violation';
      END IF;
      IF NOT (btrim(v_alias) = ANY (v_aliases)) THEN
        v_aliases := v_aliases || btrim(v_alias);
      END IF;
    END LOOP;
    IF (SELECT count(*) FROM public.trusted_voices WHERE circle_id = p_circle AND removed_at IS NULL) >= 12 THEN
      RAISE EXCEPTION 'kin: a circle may trust at most twelve voices' USING ERRCODE = 'KP004';
    END IF;
    IF EXISTS (SELECT 1 FROM public.trusted_voices WHERE circle_id = p_circle AND phone = p_phone AND removed_at IS NULL) THEN
      RAISE EXCEPTION 'kin: that number is already on the list' USING ERRCODE = 'unique_violation';
    END IF;
    IF v_circle.demo THEN
      INSERT INTO public.trusted_voices (id, circle_id, name, relationship, phone, locale, aliases, confirmed_at, added_by, simulated)
        VALUES (v_id, p_circle, btrim(p_name), btrim(p_relationship), p_phone, p_locale, v_aliases, now(), v_member, true);
    ELSE
      INSERT INTO public.trusted_voices (id, circle_id, name, relationship, phone, locale, aliases, confirm_token_hash, confirm_expires_at, added_by)
        VALUES (v_id, p_circle, btrim(p_name), btrim(p_relationship), p_phone, p_locale, v_aliases,
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

-- Changes the other spellings of a family member's name. The organizer or the parent.
CREATE FUNCTION kin_private.set_voice_aliases(p_circle uuid, p_voice uuid, p_aliases text[]) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_aliases text[] := '{}';
    v_alias text;
  BEGIN
    IF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'parent') OR coalesce(cardinality(p_aliases), 0) > 5 THEN
      RAISE EXCEPTION 'kin: trusted voices refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    FOREACH v_alias IN ARRAY coalesce(p_aliases, '{}') LOOP
      IF length(btrim(v_alias)) NOT BETWEEN 1 AND 80 THEN
        RAISE EXCEPTION 'kin: the trusted voice is not valid' USING ERRCODE = 'check_violation';
      END IF;
      IF NOT (btrim(v_alias) = ANY (v_aliases)) THEN
        v_aliases := v_aliases || btrim(v_alias);
      END IF;
    END LOOP;
    UPDATE public.trusted_voices SET aliases = v_aliases WHERE circle_id = p_circle AND id = p_voice AND removed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: trusted voices refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', kin_private.my_member_id(p_circle), 'trusted_voice.aliases_set', 'trusted_voice', p_voice, 'web');
  END
  $$;
--> statement-breakpoint

-- Sends a family member a fresh confirmation link: to confirm a number again, or to give the PayPal account help for them
-- may go to. Only for a real person: a demo's stand-in has no phone.
CREATE FUNCTION kin_private.reissue_voice_confirmation(p_circle uuid, p_voice uuid, p_token text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'parent')
       OR p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
      RAISE EXCEPTION 'kin: trusted voices refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE public.trusted_voices
      SET confirm_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex'), confirm_expires_at = now() + interval '7 days'
      WHERE circle_id = p_circle AND id = p_voice AND removed_at IS NULL AND NOT simulated;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: trusted voices refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO public.outbox (id, circle_id, topic, payload)
      VALUES (gen_random_uuid(), p_circle, 'presence.confirm', jsonb_build_object('voiceId', p_voice, 'token', p_token));
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', kin_private.my_member_id(p_circle), 'trusted_voice.reconfirm_asked', 'trusted_voice', p_voice, 'web');
  END
  $$;
--> statement-breakpoint

DROP FUNCTION kin_private.confirm_trusted_voice(text);
--> statement-breakpoint

-- The person taps "yes, this is my number" and, if they wish, says which PayPal account is theirs: the one help for them
-- may be sent to. The link is spent. Said again by a fresh link, the account changes, unless help for them is in
-- progress, which an address change must never redirect.
CREATE FUNCTION kin_private.confirm_trusted_voice(p_token text, p_receiver text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_voice public.trusted_voices;
    v_circle public.circles;
    v_parent text;
    v_receiver text := nullif(lower(btrim(coalesce(p_receiver, ''))), '');
  BEGIN
    IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
      RAISE EXCEPTION 'kin: link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_receiver IS NOT NULL AND (length(v_receiver) > 127 OR v_receiver !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') THEN
      RAISE EXCEPTION 'kin: invalid PayPal email' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_voice FROM public.trusted_voices
      WHERE confirm_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') AND removed_at IS NULL FOR UPDATE;
    SELECT * INTO v_circle FROM public.circles WHERE id = v_voice.circle_id AND status = 'active';
    IF v_voice.id IS NULL OR v_circle.id IS NULL OR v_voice.confirm_expires_at <= now() THEN
      RAISE EXCEPTION 'kin: link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_receiver IS NOT NULL AND v_receiver IS DISTINCT FROM v_voice.paypal_receiver THEN
      IF EXISTS (
        SELECT 1 FROM public.proposals p JOIN public.payees y ON y.circle_id = p.circle_id AND y.id = p.payee_id
          WHERE y.circle_id = v_voice.circle_id AND y.voice_id = v_voice.id AND p.state IN ('pending_approval', 'approved', 'executing')
      ) THEN
        RAISE EXCEPTION 'kin: help for this person is in progress' USING ERRCODE = 'KB009';
      END IF;
    END IF;
    UPDATE public.trusted_voices
      SET confirmed_at = coalesce(confirmed_at, now()), confirm_token_hash = NULL, confirm_expires_at = NULL,
          paypal_receiver = coalesce(v_receiver, paypal_receiver),
          receiver_confirmed_at = CASE WHEN v_receiver IS NOT NULL THEN now() ELSE receiver_confirmed_at END
      WHERE id = v_voice.id;
    IF v_receiver IS NOT NULL THEN
      UPDATE public.payees SET paypal_receiver = v_receiver WHERE circle_id = v_voice.circle_id AND voice_id = v_voice.id AND paypal_receiver IS DISTINCT FROM v_receiver;
    END IF;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), v_voice.circle_id, 'service', NULL, 'trusted_voice.confirmed', 'trusted_voice', v_voice.id,
              jsonb_build_object('account_given', v_receiver IS NOT NULL), 'link');
    SELECT split_part(btrim(display_name), ' ', 1) INTO v_parent FROM public.members
      WHERE circle_id = v_voice.circle_id AND role = 'parent' AND status = 'active' ORDER BY joined_at LIMIT 1;
    RETURN jsonb_build_object('name', split_part(btrim(v_voice.name), ' ', 1), 'parentFirstName', coalesce(v_parent, ''), 'confirmed', true);
  END
  $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The answer, by link or by Kin's call
-- ---------------------------------------------------------------------------

-- What an answer does, once someone has been identified: shared by the link and the call, so there is one rule.
--   * "not me" holds outgoing money for a day and tells the family;
--   * "me" lifts the hold this check made and tells the family that nothing has moved;
--   * the same answer twice changes nothing; a "yes" after a "no" is refused.
CREATE FUNCTION kin_private.apply_presence_answer(p_check uuid, p_answer text, p_via text) RETURNS jsonb
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
              jsonb_build_object('answer', p_answer, 'from', v_check.state, 'via', p_via), p_via);
    RETURN jsonb_build_object('state', v_target, 'changed', true);
  END
  $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION kin_private.answer_presence_check(p_token text, p_answer text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_id uuid;
  BEGIN
    IF p_answer IS NULL OR p_answer NOT IN ('me', 'not_me') OR p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
      RAISE EXCEPTION 'kin: link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT id INTO v_id FROM public.presence_checks WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'kin: link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN kin_private.apply_presence_answer(v_id, p_answer, 'link');
  END
  $$;
--> statement-breakpoint

-- Kin's call to the real person got an answer. As Kin's service, for the circle it names, for the very call it placed
-- for this check: a call that is not this check's cannot answer it.
CREATE FUNCTION kin_private.answer_presence_check_by_call(p_circle uuid, p_check uuid, p_call_sid text, p_answer text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF session_user <> 'kin_service' OR kin_private.circle_id() IS DISTINCT FROM p_circle OR p_answer IS NULL OR p_answer NOT IN ('me', 'not_me')
       OR p_call_sid IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.presence_checks WHERE circle_id = p_circle AND id = p_check AND ask_call_sid = p_call_sid
       ) THEN
      RAISE EXCEPTION 'kin: presence checks refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN kin_private.apply_presence_answer(p_check, p_answer, 'call');
  END
  $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Kin's call to the real person
-- ---------------------------------------------------------------------------

-- The checks waiting for Kin's call: texted thirty seconds ago and not answered, not a demo's, not yet tried, and
-- not so old that the family has long since been told. Across circles, as Kin's service only.
CREATE FUNCTION kin_private.due_presence_calls() RETURNS TABLE (circle_id uuid, check_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF session_user <> 'kin_service' THEN
      RAISE EXCEPTION 'kin: only Kin''s service places presence calls' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN QUERY
      SELECT c.circle_id, c.id FROM public.presence_checks c
        WHERE c.state IN ('asked', 'unanswered') AND NOT c.simulated AND c.voice_id IS NOT NULL AND c.call_attempted_at IS NULL
          AND c.asked_at IS NOT NULL AND c.asked_at <= now() - interval '30 seconds' AND c.asked_at > now() - interval '5 minutes'
          AND c.expires_at > now()
        ORDER BY c.asked_at LIMIT 10;
  END
  $$;
--> statement-breakpoint

-- Commits the attempt before any dial, so a second worker, or this one after a crash, never rings twice, and says whom
-- to call. `null` when the check is not due for a call (answered, over, a demo's, or already tried).
CREATE FUNCTION kin_private.start_presence_call(p_circle uuid, p_check uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_check public.presence_checks;
    v_voice public.trusted_voices;
    v_circle public.circles;
    v_parent text;
  BEGIN
    IF session_user <> 'kin_service' OR kin_private.circle_id() IS DISTINCT FROM p_circle THEN
      RAISE EXCEPTION 'kin: presence checks refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_check FROM public.presence_checks WHERE circle_id = p_circle AND id = p_check FOR UPDATE;
    IF NOT FOUND OR v_check.state NOT IN ('asked', 'unanswered') OR v_check.simulated OR v_check.call_attempted_at IS NOT NULL
       OR v_check.voice_id IS NULL OR v_check.expires_at <= now() THEN
      RETURN NULL;
    END IF;
    SELECT * INTO v_voice FROM public.trusted_voices WHERE circle_id = p_circle AND id = v_check.voice_id AND removed_at IS NULL AND confirmed_at IS NOT NULL;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    IF v_voice.id IS NULL OR v_circle.id IS NULL THEN
      RETURN NULL;
    END IF;
    SELECT display_name INTO v_parent FROM public.members WHERE circle_id = p_circle AND role = 'parent' AND status = 'active' ORDER BY joined_at LIMIT 1;
    UPDATE public.presence_checks SET call_attempted_at = now() WHERE id = v_check.id;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, origin)
      VALUES (gen_random_uuid(), p_circle, 'service', NULL, 'presence_check.call_started', 'presence_check', v_check.id, 'worker');
    RETURN jsonb_build_object('phone', v_voice.phone, 'locale', v_voice.locale, 'name', v_voice.name, 'parentName', coalesce(v_parent, ''),
                              'claimedCents', v_check.claimed_cents, 'currency', v_circle.currency);
  END
  $$;
--> statement-breakpoint

-- Twilio accepted the call: its ID is kept, once, and is what lets the call's answer count.
CREATE FUNCTION kin_private.record_presence_call_sid(p_circle uuid, p_check uuid, p_sid text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF session_user <> 'kin_service' OR kin_private.circle_id() IS DISTINCT FROM p_circle OR p_sid !~ '^CA[0-9a-fA-F]{32}$' THEN
      RAISE EXCEPTION 'kin: presence checks refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE public.presence_checks SET ask_call_sid = p_sid WHERE circle_id = p_circle AND id = p_check AND ask_call_sid IS NULL;
  END
  $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The weekly family code
-- ---------------------------------------------------------------------------

-- The seed the code's three words are worked out from, with the week, in the app. Made on first use. The organizer, a
-- contributor and the parent may have it: it is the family's secret, so a caregiver and an observer may not. Kin's
-- service may, for the circle it is scoped to, to check what the parent says a caller told her.
CREATE FUNCTION kin_private.family_code_seed(p_circle uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_seed text;
  BEGIN
    IF session_user = 'kin_service' THEN
      IF kin_private.circle_id() IS DISTINCT FROM p_circle THEN
        RAISE EXCEPTION 'kin: the family code is refused' USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor', 'parent') THEN
      RAISE EXCEPTION 'kin: the family code is refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.circles WHERE id = p_circle AND status = 'active') THEN
      RAISE EXCEPTION 'kin: the family code is refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO public.family_codes (id, circle_id, seed)
      VALUES (gen_random_uuid(), p_circle, encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text || gen_random_uuid()::text, 'UTF8')), 'hex'))
      ON CONFLICT (circle_id) DO NOTHING;
    SELECT seed INTO v_seed FROM public.family_codes WHERE circle_id = p_circle;
    RETURN v_seed;
  END
  $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Help that can go only to the real person's own account
-- ---------------------------------------------------------------------------

-- After "yes, it was me", the family may raise one payment of help to that person. It is an ordinary caregiver-style
-- payout proposal: the approval engine's plan is checked against the agreement here, as for a shift, the family
-- approves it like any other, and the money goes through the same worker. What this adds:
--   * the check must be confirmed by the person, with a trusted voice that still stands, and not already have help raised;
--   * the person must have confirmed a PayPal account, and the payee is made from that account alone (a trigger refuses
--     any other address on a help payee, and the worker checks again before it pays);
--   * no more than the caller asked for, and never above the agreement's ceiling.
-- The organizer, a contributor or the parent may raise it.
CREATE FUNCTION kin_private.request_help_payout(p_circle uuid, p_check uuid, p_cents bigint, p_note text, p_plan jsonb) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_check public.presence_checks;
    v_voice public.trusted_voices;
    v_payee public.payees;
    v_agreement public.agreements;
    v_now timestamptz;
    v_first jsonb;
    v_slots jsonb;
    v_expires timestamptz;
    v_proposal uuid := gen_random_uuid();
  BEGIN
    IF v_role IS NULL OR v_role NOT IN ('organizer', 'contributor', 'parent') OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: help refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    SELECT * INTO v_check FROM public.presence_checks WHERE circle_id = p_circle AND id = p_check FOR UPDATE;
    IF v_circle.id IS NULL OR v_check.id IS NULL OR p_cents IS NULL OR p_cents <= 0 OR p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 1 AND 300 THEN
      RAISE EXCEPTION 'kin: help refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_check.state <> 'confirmed' OR v_check.voice_id IS NULL OR v_check.help_proposal_id IS NOT NULL THEN
      RAISE EXCEPTION 'kin: help needs the person to have said it was them, and only once' USING ERRCODE = 'KP008';
    END IF;
    SELECT * INTO v_voice FROM public.trusted_voices WHERE circle_id = p_circle AND id = v_check.voice_id FOR UPDATE;
    IF v_voice.id IS NULL OR v_voice.removed_at IS NOT NULL OR v_voice.confirmed_at IS NULL OR v_voice.paypal_receiver IS NULL OR v_voice.receiver_confirmed_at IS NULL THEN
      RAISE EXCEPTION 'kin: the person has not confirmed an account' USING ERRCODE = 'KP007';
    END IF;
    IF v_check.claimed_cents IS NOT NULL AND p_cents > v_check.claimed_cents THEN
      RAISE EXCEPTION 'kin: help cannot exceed what was asked for' USING ERRCODE = 'KP005';
    END IF;
    SELECT * INTO v_agreement FROM kin_private.agreement_in_force(p_circle);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: the circle has no agreement to approve with' USING ERRCODE = 'KB008';
    END IF;
    v_now := coalesce(v_circle.clock_at, now());
    IF v_circle.paused_until IS NOT NULL AND v_circle.paused_until > v_now THEN
      RAISE EXCEPTION 'kin: the circle is paused' USING ERRCODE = 'KB007';
    END IF;
    IF p_cents > v_agreement.ceiling_cents THEN
      RAISE EXCEPTION 'kin: the help is above the agreement''s ceiling' USING ERRCODE = 'KB006';
    END IF;

    SELECT * INTO v_payee FROM public.payees WHERE circle_id = p_circle AND voice_id = v_voice.id FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.payees (id, circle_id, name, category, status, paypal_receiver, payout_wallet, voice_id)
        VALUES (gen_random_uuid(), p_circle, v_voice.name, 'family_help', 'new', v_voice.paypal_receiver, 'paypal', v_voice.id)
        RETURNING * INTO v_payee;
    ELSIF v_payee.paypal_receiver IS DISTINCT FROM v_voice.paypal_receiver THEN
      UPDATE public.payees SET paypal_receiver = v_voice.paypal_receiver WHERE id = v_payee.id RETURNING * INTO v_payee;
    END IF;

    v_first := CASE WHEN EXISTS (
        SELECT 1 FROM public.members WHERE circle_id = p_circle AND role = 'parent' AND status = 'active' AND parent_level = 'decides'
      ) AND p_cents > v_agreement.parent_decides_above_cents
      THEN '{"reason": "parent_decides", "roles": ["parent"]}'::jsonb
      ELSE '{"reason": "organizer", "roles": ["organizer"]}'::jsonb END;
    v_slots := CASE WHEN p_cents > v_agreement.second_approval_above_cents
      THEN jsonb_build_array(v_first, '{"reason": "second_approval", "roles": ["organizer", "contributor"]}'::jsonb)
      ELSE jsonb_build_array(v_first) END;
    BEGIN
      v_expires := (p_plan ->> 'expiresAt')::timestamptz;
    EXCEPTION WHEN others THEN
      v_expires := NULL;
    END;
    IF jsonb_typeof(p_plan) IS DISTINCT FROM 'object'
       OR p_plan - ARRAY['outcome', 'slots', 'payeeMemberId', 'announceToCircle', 'expiresAt'] <> '{}'::jsonb
       OR p_plan ->> 'outcome' IS DISTINCT FROM 'needs_approval'
       OR p_plan -> 'slots' IS DISTINCT FROM v_slots
       OR p_plan ->> 'payeeMemberId' IS NOT NULL
       OR p_plan -> 'announceToCircle' IS DISTINCT FROM to_jsonb(v_payee.status = 'new')
       OR v_expires IS NULL
       OR v_expires NOT BETWEEN v_now + interval '71 hours 55 minutes' AND v_now + interval '72 hours 5 minutes' THEN
      RAISE EXCEPTION 'kin: the approval plan does not match the agreement' USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.proposals (id, circle_id, kind, cents, payee_id, purpose, note, raised_by, raised_at, state, expires_at, agreement_version, plan)
      VALUES (v_proposal, p_circle, 'caregiver_payout', p_cents, v_payee.id, 'family_help', btrim(p_note), v_me, v_now, 'pending_approval', v_expires, v_agreement.version, p_plan);
    UPDATE public.presence_checks SET help_proposal_id = v_proposal WHERE id = v_check.id;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'presence_check.help_raised', 'presence_check', v_check.id,
              jsonb_build_object('proposalId', v_proposal, 'cents', p_cents), 'web');
    RETURN v_proposal;
  END
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.add_trusted_voice(uuid, text, text, text, text, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.set_voice_aliases(uuid, uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.reissue_voice_confirmation(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.confirm_trusted_voice(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.apply_presence_answer(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.answer_presence_check_by_call(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.due_presence_calls() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.start_presence_call(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.record_presence_call_sid(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.family_code_seed(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.request_help_payout(uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.add_trusted_voice(uuid, text, text, text, text, text, text[]) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.set_voice_aliases(uuid, uuid, text[]) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.reissue_voice_confirmation(uuid, uuid, text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.confirm_trusted_voice(text, text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.answer_presence_check_by_call(uuid, uuid, text, text) TO kin_service;
GRANT EXECUTE ON FUNCTION kin_private.due_presence_calls() TO kin_service;
GRANT EXECUTE ON FUNCTION kin_private.start_presence_call(uuid, uuid) TO kin_service;
GRANT EXECUTE ON FUNCTION kin_private.record_presence_call_sid(uuid, uuid, text) TO kin_service;
GRANT EXECUTE ON FUNCTION kin_private.family_code_seed(uuid) TO kin_app, kin_service;
GRANT EXECUTE ON FUNCTION kin_private.request_help_payout(uuid, uuid, bigint, text, jsonb) TO kin_app;

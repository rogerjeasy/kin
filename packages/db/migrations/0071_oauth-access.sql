-- OAuth 2.1 for Kin's MCP server (docs/architecture.md section 13.4,
-- decision 112). Kin is its own authorization server, and the access token
-- it issues IS a delegation: the same row, the same hash, the same scope, the
-- same five-a-member limit, the same revocation and the same screen.
--
-- An authorization code is the member's yes on the consent screen. It is
-- written by the member, as themselves, and traded once by the client with
-- nobody signed in, exactly like a check-in link: only the holder of the
-- code, its PKCE verifier, its client ID and its redirect URI can trade it.
-- No role reads oauth_codes; the two operations below are the only way in.
--
-- Client registrations hold no circle data and are not stored at all: the
-- web app signs a registered client's name and redirect URIs into its client
-- ID (packages/auth/src/oauth.ts), so there is no global table to guard.
--
-- Refusals that screens word, by SQLSTATE:
--   42501  the person may not do this
--   KD001  the member already holds five live delegations
--   KO001  OAuth connects real circles only, never a demo
--   KO002  too many consents from this member in ten minutes
ALTER TABLE public.oauth_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Like every circle table: the service acts for the circle it names. No
-- screen reads a code, so kin_app has no policy and no grant (a code's hash
-- is a credential, like a check-in link's).
CREATE POLICY service_own_circle ON public.oauth_codes FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
GRANT SELECT (oauth_client) ON public.delegations TO kin_app, kin_service;
--> statement-breakpoint

CREATE TRIGGER no_delete BEFORE DELETE ON public.oauth_codes
  FOR EACH ROW EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER no_delete_truncate BEFORE TRUNCATE ON public.oauth_codes
  FOR EACH STATEMENT EXECUTE FUNCTION kin_private.refuse_change();
--> statement-breakpoint

-- What a code says never changes. It is used once, and then names, once, the
-- delegation it was traded for.
CREATE FUNCTION kin_private.assert_oauth_code_fixed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF (to_jsonb(NEW) - ARRAY['used_at', 'delegation_id']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['used_at', 'delegation_id']) THEN
      RAISE EXCEPTION 'kin: authorization code % cannot change what it says', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at THEN
      RAISE EXCEPTION 'kin: authorization code % was used once already', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.delegation_id IS NOT NULL AND NEW.delegation_id IS DISTINCT FROM OLD.delegation_id THEN
      RAISE EXCEPTION 'kin: authorization code % was traded already', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER code_fixed BEFORE UPDATE ON public.oauth_codes
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_oauth_code_fixed();
--> statement-breakpoint

-- The one path that creates a delegation, for a member named by the caller:
-- grant_delegation names the person signed in, redeem_oauth_code the member
-- who said yes on the consent screen. Any active member but an observer may
-- hold one; it lasts from an hour to ninety days, and a member holds at most
-- five live ones. The live console's lasts fifteen minutes, exists only in
-- a demo circle and replaces the member's previous one. Not open to any role.
CREATE FUNCTION kin_private.issue_delegation(p_circle uuid, p_member uuid, p_label text, p_scope text, p_token_hash text, p_hint text,
    p_expires_at timestamptz, p_console boolean, p_oauth_client text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role text;
    v_demo boolean;
    v_id uuid := gen_random_uuid();
  BEGIN
    SELECT m.role INTO v_role FROM public.members m WHERE m.circle_id = p_circle AND m.id = p_member AND m.status = 'active';
    -- An observer reads and never writes, so connects no assistant.
    IF NOT FOUND OR v_role = 'observer' THEN
      RAISE EXCEPTION 'kin: granting a delegation refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT c.demo INTO v_demo FROM public.circles c WHERE c.id = p_circle AND c.status = 'active' FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: granting a delegation refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_console THEN
      IF NOT v_demo THEN
        RAISE EXCEPTION 'kin: the live console works only in a demo circle' USING ERRCODE = 'KD002';
      END IF;
      IF p_expires_at <= now() OR p_expires_at > now() + interval '16 minutes' THEN
        RAISE EXCEPTION 'kin: the console delegation lasts fifteen minutes' USING ERRCODE = 'check_violation';
      END IF;
      UPDATE public.delegations SET revoked_at = now(), revoked_by = p_member
        WHERE circle_id = p_circle AND member_id = p_member AND console AND revoked_at IS NULL;
    ELSE
      IF p_expires_at < now() + interval '59 minutes' OR p_expires_at > now() + interval '91 days' THEN
        RAISE EXCEPTION 'kin: a delegation lasts from an hour to ninety days' USING ERRCODE = 'check_violation';
      END IF;
      IF (SELECT count(*) FROM public.delegations
          WHERE circle_id = p_circle AND member_id = p_member AND NOT console AND revoked_at IS NULL AND expires_at > now()) >= 5 THEN
        RAISE EXCEPTION 'kin: five live delegations already' USING ERRCODE = 'KD001';
      END IF;
    END IF;
    INSERT INTO public.delegations (id, circle_id, member_id, label, scope, token_hash, token_hint, console, oauth_client, expires_at)
      VALUES (v_id, p_circle, p_member, btrim(p_label), p_scope, p_token_hash, p_hint, p_console, p_oauth_client, p_expires_at);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', p_member, 'delegation.granted', 'delegation', v_id,
        jsonb_build_object('scope', p_scope, 'console', p_console, 'expiresAt', p_expires_at, 'oauth', p_oauth_client IS NOT NULL),
        CASE WHEN p_oauth_client IS NULL THEN 'web' ELSE 'oauth' END);
    RETURN v_id;
  END
  $$;
--> statement-breakpoint

-- Granting from the screen is unchanged: the person signed in, for their own seat.
CREATE OR REPLACE FUNCTION kin_private.grant_delegation(p_circle uuid, p_label text, p_scope text, p_token_hash text, p_hint text, p_expires_at timestamptz, p_console boolean) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
  BEGIN
    IF v_me IS NULL THEN
      RAISE EXCEPTION 'kin: granting a delegation refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN kin_private.issue_delegation(p_circle, v_me, p_label, p_scope, p_token_hash, p_hint, p_expires_at, p_console, NULL);
  END
  $$;
--> statement-breakpoint

-- The member's yes on the consent screen, for their own seat in a real
-- circle: a code that lives sixty seconds, bound to everything the client
-- will have to present again. Refused for an observer, in a demo circle, and
-- when the member already holds five live delegations, so the screen can say
-- so before the client is sent back.
CREATE FUNCTION kin_private.create_oauth_code(p_circle uuid, p_code_hash text, p_client_id text, p_client_name text, p_redirect_uri text,
    p_challenge text, p_scope text, p_days integer, p_resource text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_demo boolean;
  BEGIN
    IF v_me IS NULL OR kin_private.my_role(p_circle) = 'observer' THEN
      RAISE EXCEPTION 'kin: authorizing a client refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT c.demo INTO v_demo FROM public.circles c WHERE c.id = p_circle AND c.status = 'active' FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: authorizing a client refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_demo THEN
      RAISE EXCEPTION 'kin: OAuth connects real circles only' USING ERRCODE = 'KO001';
    END IF;
    IF (SELECT count(*) FROM public.delegations
        WHERE circle_id = p_circle AND member_id = v_me AND NOT console AND revoked_at IS NULL AND expires_at > now()) >= 5 THEN
      RAISE EXCEPTION 'kin: five live delegations already' USING ERRCODE = 'KD001';
    END IF;
    IF (SELECT count(*) FROM public.oauth_codes WHERE circle_id = p_circle AND member_id = v_me AND created_at > now() - interval '10 minutes') >= 20 THEN
      RAISE EXCEPTION 'kin: too many authorizations in ten minutes' USING ERRCODE = 'KO002';
    END IF;
    INSERT INTO public.oauth_codes (id, circle_id, member_id, code_hash, client_id, client_name, redirect_uri, code_challenge, scope, days, resource, expires_at)
      VALUES (gen_random_uuid(), p_circle, v_me, p_code_hash, p_client_id, btrim(p_client_name), p_redirect_uri, p_challenge, p_scope, p_days, p_resource,
        now() + interval '60 seconds');
  END
  $$;
--> statement-breakpoint

-- The client trades a code for a delegation, with nobody signed in. The code
-- is spent by the first attempt, right or wrong, so a guessed verifier gets
-- one try. A code presented again was replayed or stolen: the delegation it
-- was traded for is revoked (OAuth 2.1 section 4.1.3). Returns the delegation,
-- or an OAuth error code and nothing about why; never raises for a bad code,
-- so that spending it is kept.
CREATE FUNCTION kin_private.redeem_oauth_code(p_code_hash text, p_client_id text, p_redirect_uri text, p_challenge text, p_resource text,
    p_token_hash text, p_hint text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_code public.oauth_codes;
    v_id uuid;
    v_expires timestamptz;
    v_revoked integer;
  BEGIN
    IF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
      RETURN jsonb_build_object('error', 'invalid_grant');
    END IF;
    SELECT * INTO v_code FROM public.oauth_codes WHERE code_hash = p_code_hash FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'invalid_grant');
    END IF;
    IF v_code.used_at IS NOT NULL THEN
      IF v_code.delegation_id IS NOT NULL THEN
        UPDATE public.delegations SET revoked_at = now(), revoked_by = v_code.member_id
          WHERE circle_id = v_code.circle_id AND id = v_code.delegation_id AND revoked_at IS NULL;
        GET DIAGNOSTICS v_revoked = ROW_COUNT;
        IF v_revoked > 0 THEN
          INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
            VALUES (gen_random_uuid(), v_code.circle_id, 'service', NULL, 'delegation.revoked', 'delegation', v_code.delegation_id,
              jsonb_build_object('reason', 'authorization_code_replayed'), 'oauth');
        END IF;
      END IF;
      RETURN jsonb_build_object('error', 'invalid_grant');
    END IF;
    UPDATE public.oauth_codes SET used_at = now() WHERE id = v_code.id;
    -- OAuth 2.1 lets a client leave the redirect URI out of the trade; one it sends must be the code's.
    IF v_code.expires_at <= now() OR v_code.client_id IS DISTINCT FROM p_client_id
        OR (p_redirect_uri IS NOT NULL AND v_code.redirect_uri IS DISTINCT FROM p_redirect_uri)
        OR v_code.code_challenge IS DISTINCT FROM p_challenge THEN
      RETURN jsonb_build_object('error', 'invalid_grant');
    END IF;
    IF v_code.resource IS DISTINCT FROM p_resource THEN
      RETURN jsonb_build_object('error', 'invalid_target');
    END IF;
    v_expires := now() + make_interval(days => v_code.days);
    BEGIN
      v_id := kin_private.issue_delegation(v_code.circle_id, v_code.member_id, v_code.client_name, v_code.scope, p_token_hash, p_hint, v_expires, false, v_code.client_id);
    EXCEPTION
      WHEN SQLSTATE 'KD001' THEN RETURN jsonb_build_object('error', 'too_many');
      WHEN insufficient_privilege THEN RETURN jsonb_build_object('error', 'invalid_grant');
    END;
    UPDATE public.oauth_codes SET delegation_id = v_id WHERE id = v_code.id;
    RETURN jsonb_build_object('delegationId', v_id, 'scope', v_code.scope, 'expiresAt', v_expires);
  END
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.assert_oauth_code_fixed() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.issue_delegation(uuid, uuid, text, text, text, text, timestamptz, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.create_oauth_code(uuid, text, text, text, text, text, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.redeem_oauth_code(text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.create_oauth_code(uuid, text, text, text, text, text, text, integer, text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.redeem_oauth_code(text, text, text, text, text, text, text) TO kin_app;

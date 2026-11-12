-- Invitations a person actually receives (docs/architecture.md section 12.3).
--
-- An organizer's invitation to a real circle is emailed: the invitation and an
-- outbox message for Kin's worker are written together, the message carrying a
-- fresh link token and the invitation keeping only its SHA-256. The link only
-- shows who invited whom; joining still needs a sign-in with the verified
-- address the invitation names. A demo circle's invitation is never emailed.
--
-- SQLSTATE codes raised here: KI001 too many invitations today, KI002 that
-- address already has one waiting, KI003 that address is already a member.

-- The limits hold for every way an invitation is written, the direct insert
-- the app_invite policy allows included. Two invitations at once for the same
-- circle wait for each other, so neither can slip past the count.
CREATE FUNCTION kin_private.assert_invitation_limits() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('kin.invitations:' || NEW.circle_id::text));
    IF (SELECT count(*) FROM public.invitations WHERE circle_id = NEW.circle_id AND created_at > now() - interval '24 hours') >= 20 THEN
      RAISE EXCEPTION 'kin: a circle may send at most twenty invitations a day' USING ERRCODE = 'KI001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.invitations
               WHERE circle_id = NEW.circle_id AND lower(email) = lower(NEW.email) AND status = 'pending' AND expires_at > now()) THEN
      RAISE EXCEPTION 'kin: that address already has an invitation waiting' USING ERRCODE = 'KI002';
    END IF;
    IF EXISTS (SELECT 1 FROM public.members m JOIN public.users u ON u.id = m.user_id
               WHERE m.circle_id = NEW.circle_id AND m.status = 'active' AND lower(u.email) = lower(NEW.email)) THEN
      RAISE EXCEPTION 'kin: that address is already a member' USING ERRCODE = 'KI003';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER invitation_limits BEFORE INSERT ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_invitation_limits();
--> statement-breakpoint

-- An organizer invites someone to a role. In a real circle the email goes out
-- through the outbox; in a demo circle nothing leaves Kin.
CREATE FUNCTION kin_private.invite_member(
  p_circle uuid, p_email text, p_role public.circle_role, p_expires_at timestamptz, p_locale text, p_token text
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_circle public.circles;
    v_member uuid := kin_private.my_member_id(p_circle);
    v_id uuid := gen_random_uuid();
    v_email text := lower(btrim(coalesce(p_email, '')));
  BEGIN
    IF v_member IS NULL OR NOT coalesce(kin_private.is_organizer(p_circle), false) THEN
      RAISE EXCEPTION 'kin: only an organizer may invite' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: only an organizer may invite' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$'
       OR p_locale IS NULL OR p_locale NOT IN ('en', 'fr', 'de', 'it', 'es', 'ar', 'he')
       OR length(v_email) > 254 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
       OR p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '30 days' THEN
      RAISE EXCEPTION 'kin: the invitation is not valid' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.invitations (id, circle_id, email, role, invited_by, expires_at, link_token_hash)
      VALUES (v_id, p_circle, v_email, p_role, v_member, p_expires_at,
              CASE WHEN v_circle.demo THEN NULL ELSE encode(sha256(convert_to(p_token, 'UTF8')), 'hex') END);
    IF NOT v_circle.demo THEN
      INSERT INTO public.outbox (id, circle_id, topic, payload)
        VALUES (gen_random_uuid(), p_circle, 'invitation.email', jsonb_build_object('invitationId', v_id, 'locale', p_locale, 'token', p_token));
    END IF;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_member, 'member.invited', 'invitation', v_id,
              jsonb_build_object('role', p_role, 'emailed', NOT v_circle.demo), 'web');
    RETURN v_id;
  END
  $$;
--> statement-breakpoint

-- The page the invitation email links to, opened with nobody signed in. First
-- names and the role only: never the address, never an ID.
CREATE FUNCTION kin_private.invitation_link_status(p_token text) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_invitation public.invitations;
    v_inviter text;
    v_parent text;
  BEGIN
    IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
      RAISE EXCEPTION 'kin: link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT i.* INTO v_invitation FROM public.invitations i JOIN public.circles c ON c.id = i.circle_id
      WHERE i.link_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') AND NOT c.demo AND c.status = 'active';
    IF v_invitation.id IS NULL THEN
      RAISE EXCEPTION 'kin: link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT split_part(btrim(display_name), ' ', 1) INTO v_inviter FROM public.members
      WHERE circle_id = v_invitation.circle_id AND id = v_invitation.invited_by;
    SELECT split_part(btrim(display_name), ' ', 1) INTO v_parent FROM public.members
      WHERE circle_id = v_invitation.circle_id AND role = 'parent' AND status = 'active' ORDER BY joined_at LIMIT 1;
    RETURN jsonb_build_object(
      'inviterFirstName', coalesce(v_inviter, ''),
      'parentFirstName', coalesce(v_parent, ''),
      'role', v_invitation.role,
      'state', CASE
        WHEN v_invitation.status = 'accepted' THEN 'accepted'
        WHEN v_invitation.status = 'pending' AND v_invitation.expires_at > now() THEN 'open'
        ELSE 'closed' END);
  END
  $$;
--> statement-breakpoint

-- A person joins the real circles that invited their verified address. A
-- parent's invitation takes the seat the organizer made for her when the
-- circle was started, keeping the name and say the family gave it, so the
-- circle never has two parents for one person. Without a free parent seat, a
-- new one is made as before.
CREATE OR REPLACE FUNCTION kin_private.accept_my_invitations() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_user public.users;
    v_invitation public.invitations;
    v_joined integer := 0;
    v_member uuid;
    v_bound boolean;
  BEGIN
    SELECT * INTO v_user FROM public.users WHERE id = kin_private.user_id() AND kind = 'person' AND email_verified;
    IF v_user.id IS NULL THEN
      RETURN 0;
    END IF;
    FOR v_invitation IN
      SELECT i.* FROM public.invitations i JOIN public.circles c ON c.id = i.circle_id
      WHERE lower(i.email) = lower(v_user.email) AND i.status = 'pending' AND i.expires_at > now()
        AND NOT c.demo AND c.status = 'active'
      ORDER BY i.created_at
    LOOP
      IF NOT EXISTS (SELECT 1 FROM public.members WHERE circle_id = v_invitation.circle_id AND user_id = v_user.id) THEN
        v_member := NULL;
        IF v_invitation.role = 'parent' THEN
          SELECT id INTO v_member FROM public.members
            WHERE circle_id = v_invitation.circle_id AND role = 'parent' AND status = 'active' AND user_id IS NULL
            ORDER BY joined_at, id LIMIT 1 FOR UPDATE;
        END IF;
        v_bound := v_member IS NOT NULL;
        IF v_bound THEN
          UPDATE public.members SET user_id = v_user.id WHERE id = v_member;
        ELSE
          v_member := gen_random_uuid();
          INSERT INTO public.members (id, circle_id, user_id, display_name, role, parent_level)
            VALUES (v_member, v_invitation.circle_id, v_user.id, v_user.name, v_invitation.role,
                    CASE WHEN v_invitation.role = 'parent' THEN 'decides'::public.parent_level END);
        END IF;
        INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
          VALUES (gen_random_uuid(), v_invitation.circle_id, 'member', v_member, 'invitation.accepted', 'invitation', v_invitation.id,
                  jsonb_build_object('seat', CASE WHEN v_bound THEN 'parent_placeholder' ELSE 'new' END), 'web');
        v_joined := v_joined + 1;
      END IF;
      UPDATE public.invitations SET status = 'accepted', answered_at = now() WHERE id = v_invitation.id;
    END LOOP;
    RETURN v_joined;
  END
  $$;
--> statement-breakpoint

-- Function by function, as since 0033: a blanket grant would reopen what later
-- migrations closed. accept_my_invitations keeps its grants through CREATE OR REPLACE.
REVOKE ALL ON FUNCTION kin_private.assert_invitation_limits() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.invite_member(uuid, text, public.circle_role, timestamptz, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.invitation_link_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.invite_member(uuid, text, public.circle_role, timestamptz, text, text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.invitation_link_status(text) TO kin_app;

-- Invitations share Kin's Gmail sender with the sign-in codes, and a parent's
-- seat governs her money (docs/architecture.md section 12.3, decision 110).
--
-- 1. Caps that keep the sign-in codes flowing. Besides the twenty a circle may
--    send each day, in a real circle one person may send ten a day across all
--    their circles (KI004), and the whole of Kin two hundred a day (KI005),
--    leaving Gmail's daily allowance room for the codes. The worker enforces
--    the same daily ceiling on what it actually sends.
-- 2. A parent's seat is taken only on purpose. An invitation names the
--    unclaimed parent seat it is for (seat_member_id); only that invitation's
--    address can take it, and only while it is still unclaimed. A seat that is
--    not an unclaimed parent of the circle, or already has an invitation
--    waiting, is refused (KI006). A parent's invitation that names no seat
--    while the circle has an unclaimed parent seat is refused (KI008): the
--    organizer must say whether the person takes that place.
--
-- The checks are in the insert trigger, so the direct insert the app_invite
-- policy allows cannot set a seat around them.

CREATE OR REPLACE FUNCTION kin_private.assert_invitation_limits() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_demo boolean;
    v_inviter text;
  BEGIN
    SELECT demo INTO v_demo FROM public.circles WHERE id = NEW.circle_id;
    PERFORM pg_advisory_xact_lock(hashtext('kin.invitations:' || NEW.circle_id::text));
    IF NOT v_demo THEN
      -- Every real invitation is emailed, so they wait for each other across circles.
      PERFORM pg_advisory_xact_lock(hashtext('kin.invitations:real'));
    END IF;
    IF (SELECT count(*) FROM public.invitations WHERE circle_id = NEW.circle_id AND created_at > now() - interval '24 hours') >= 20 THEN
      RAISE EXCEPTION 'kin: a circle may send at most twenty invitations a day' USING ERRCODE = 'KI001';
    END IF;
    IF NOT v_demo THEN
      SELECT user_id INTO v_inviter FROM public.members WHERE circle_id = NEW.circle_id AND id = NEW.invited_by;
      IF (SELECT count(*) FROM public.invitations i JOIN public.members m ON m.circle_id = i.circle_id AND m.id = i.invited_by
          JOIN public.circles c ON c.id = i.circle_id
          WHERE m.user_id = v_inviter AND NOT c.demo AND i.created_at > now() - interval '24 hours') >= 10 THEN
        RAISE EXCEPTION 'kin: a person may send at most ten invitations a day' USING ERRCODE = 'KI004';
      END IF;
      IF (SELECT count(*) FROM public.invitations i JOIN public.circles c ON c.id = i.circle_id
          WHERE NOT c.demo AND i.created_at > now() - interval '24 hours') >= 200 THEN
        RAISE EXCEPTION 'kin: Kin sends at most two hundred invitations a day' USING ERRCODE = 'KI005';
      END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM public.invitations
               WHERE circle_id = NEW.circle_id AND lower(email) = lower(NEW.email) AND status = 'pending' AND expires_at > now()) THEN
      RAISE EXCEPTION 'kin: that address already has an invitation waiting' USING ERRCODE = 'KI002';
    END IF;
    IF EXISTS (SELECT 1 FROM public.members m JOIN public.users u ON u.id = m.user_id
               WHERE m.circle_id = NEW.circle_id AND m.status = 'active' AND lower(u.email) = lower(NEW.email)) THEN
      RAISE EXCEPTION 'kin: that address is already a member' USING ERRCODE = 'KI003';
    END IF;
    IF NEW.seat_member_id IS NOT NULL THEN
      IF NEW.role <> 'parent' OR NOT EXISTS (
           SELECT 1 FROM public.members
           WHERE circle_id = NEW.circle_id AND id = NEW.seat_member_id AND role = 'parent' AND status = 'active' AND user_id IS NULL)
         OR EXISTS (
           SELECT 1 FROM public.invitations
           WHERE circle_id = NEW.circle_id AND seat_member_id = NEW.seat_member_id AND status = 'pending' AND expires_at > now()) THEN
        RAISE EXCEPTION 'kin: that parent seat cannot be offered' USING ERRCODE = 'KI006';
      END IF;
    ELSIF NEW.role = 'parent' AND NOT v_demo AND EXISTS (
           SELECT 1 FROM public.members
           WHERE circle_id = NEW.circle_id AND role = 'parent' AND status = 'active' AND user_id IS NULL) THEN
      RAISE EXCEPTION 'kin: say whether the parent takes the seat already in the circle' USING ERRCODE = 'KI008';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

-- The organizer's invitation, now naming the seat a parent takes, if any.
DROP FUNCTION kin_private.invite_member(uuid, text, public.circle_role, timestamptz, text, text);

CREATE FUNCTION kin_private.invite_member(
  p_circle uuid, p_email text, p_role public.circle_role, p_expires_at timestamptz, p_locale text, p_token text, p_seat uuid DEFAULT NULL
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
    -- A seat of another circle would fail the foreign key; it is refused with the same answer as any other seat.
    IF p_seat IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.members WHERE circle_id = p_circle AND id = p_seat) THEN
      RAISE EXCEPTION 'kin: that parent seat cannot be offered' USING ERRCODE = 'KI006';
    END IF;
    INSERT INTO public.invitations (id, circle_id, email, role, invited_by, expires_at, link_token_hash, seat_member_id)
      VALUES (v_id, p_circle, v_email, p_role, v_member, p_expires_at,
              CASE WHEN v_circle.demo THEN NULL ELSE encode(sha256(convert_to(p_token, 'UTF8')), 'hex') END, p_seat);
    IF NOT v_circle.demo THEN
      INSERT INTO public.outbox (id, circle_id, topic, payload)
        VALUES (gen_random_uuid(), p_circle, 'invitation.email', jsonb_build_object('invitationId', v_id, 'locale', p_locale, 'token', p_token));
    END IF;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_member, 'member.invited', 'invitation', v_id,
              jsonb_build_object('role', p_role, 'emailed', NOT v_circle.demo, 'seat', p_seat IS NOT NULL), 'web');
    RETURN v_id;
  END
  $$;
--> statement-breakpoint

-- Joining by verified address. A parent's invitation that names a seat takes
-- that seat only, and only while it is still unclaimed; if someone else holds
-- it by then, the person is not seated and the invitation stays waiting, for
-- the organizer to see. An invitation that names no seat adds a member, as
-- before 0064.
CREATE OR REPLACE FUNCTION kin_private.accept_my_invitations() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_user public.users;
    v_invitation public.invitations;
    v_joined integer := 0;
    v_member uuid;
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
        IF v_invitation.seat_member_id IS NOT NULL THEN
          SELECT id INTO v_member FROM public.members
            WHERE circle_id = v_invitation.circle_id AND id = v_invitation.seat_member_id
              AND role = 'parent' AND status = 'active' AND user_id IS NULL
            FOR UPDATE;
          IF v_member IS NULL THEN
            CONTINUE;
          END IF;
          UPDATE public.members SET user_id = v_user.id WHERE id = v_member;
        ELSE
          v_member := gen_random_uuid();
          INSERT INTO public.members (id, circle_id, user_id, display_name, role, parent_level)
            VALUES (v_member, v_invitation.circle_id, v_user.id, v_user.name, v_invitation.role,
                    CASE WHEN v_invitation.role = 'parent' THEN 'decides'::public.parent_level END);
        END IF;
        INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
          VALUES (gen_random_uuid(), v_invitation.circle_id, 'member', v_member, 'invitation.accepted', 'invitation', v_invitation.id,
                  jsonb_build_object('seat', CASE WHEN v_invitation.seat_member_id IS NOT NULL THEN 'named' ELSE 'new' END), 'web');
        v_joined := v_joined + 1;
      END IF;
      UPDATE public.invitations SET status = 'accepted', answered_at = now() WHERE id = v_invitation.id;
    END LOOP;
    RETURN v_joined;
  END
  $$;
--> statement-breakpoint

-- How many invitation emails the worker sent in the last day, across circles,
-- so it can hold back before Gmail's allowance for sign-in codes runs short.
-- A count only: no circle, no address. Kin's service only.
CREATE FUNCTION kin_private.invitation_emails_sent_today() RETURNS integer
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF session_user <> 'kin_service' THEN
      RAISE EXCEPTION 'kin: only Kin''s service counts invitation emails' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN (SELECT count(*) FROM public.audit_log WHERE action = 'invitation.emailed' AND at > now() - interval '24 hours');
  END
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.invite_member(uuid, text, public.circle_role, timestamptz, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.invite_member(uuid, text, public.circle_role, timestamptz, text, text, uuid) TO kin_app;
REVOKE ALL ON FUNCTION kin_private.invitation_emails_sent_today() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.invitation_emails_sent_today() TO kin_service;

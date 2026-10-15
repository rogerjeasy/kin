-- What people may now do in a circle, and the demo kept apart from real
-- families (docs/architecture.md sections 12.3 and 20.3).
--
-- A demo visitor is an anonymous user (kind demo_visitor, ID "demo:...") who
-- pressed the Demo button. They hold seats only in demo circles. A person who
-- signed in holds seats only in real circles. Every write a person makes goes
-- through row-level security as kin_app; the decisions themselves (who must
-- say yes, whether a proposal is approved) are made by packages/domain.

-- Circles provisioned before visitors existed seated signed-in people in demo
-- circles. Those circles are archived, never deleted, so no real account
-- shows demo data.
UPDATE public.members m SET status = 'left'
  FROM public.circles c
  WHERE c.id = m.circle_id AND c.demo AND m.user_id IS NOT NULL AND m.status = 'active';
UPDATE public.circles SET status = 'archived' WHERE demo AND status = 'active'
  AND NOT EXISTS (SELECT 1 FROM public.members m WHERE m.circle_id = circles.id AND m.status = 'active' AND m.user_id IS NOT NULL);
--> statement-breakpoint

-- Demo seats for visitors, real seats for people, and never the other way.
CREATE FUNCTION kin_private.assert_seat_matches_circle() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_kind public.user_kind;
    v_demo boolean;
  BEGIN
    IF NEW.user_id IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT kind INTO v_kind FROM public.users WHERE id = NEW.user_id;
    SELECT demo INTO v_demo FROM public.circles WHERE id = NEW.circle_id;
    IF (v_kind = 'demo_visitor') IS DISTINCT FROM v_demo THEN
      RAISE EXCEPTION 'kin: a % cannot hold a seat in a % circle', v_kind, CASE WHEN v_demo THEN 'demo' ELSE 'real' END
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER seat_matches_circle BEFORE INSERT OR UPDATE OF user_id ON public.members
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_seat_matches_circle();
--> statement-breakpoint

-- A visitor plays any role in their demo circle by taking another persona's
-- empty seat. Only in a demo circle where they hold the demo seat.
CREATE FUNCTION kin_private.take_demo_seat(p_circle uuid, p_member uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_seat uuid;
  BEGIN
    SELECT m.id INTO v_seat FROM public.members m
      JOIN public.circles c ON c.id = m.circle_id
      WHERE m.circle_id = p_circle AND m.user_id = kin_private.user_id() AND m.demo_seat
        AND m.status = 'active' AND c.demo AND c.status = 'active';
    IF v_seat IS NULL THEN
      RAISE EXCEPTION 'kin: % holds no demo seat in circle %', coalesce(kin_private.user_id(), 'nobody'), p_circle
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_seat = p_member THEN
      RETURN;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.members WHERE id = p_member AND circle_id = p_circle AND status = 'active' AND user_id IS NULL
    ) THEN
      RAISE EXCEPTION 'kin: member % is not a free seat in circle %', p_member, p_circle
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE public.members SET user_id = NULL, demo_seat = false WHERE id = v_seat;
    UPDATE public.members SET user_id = kin_private.user_id(), demo_seat = true WHERE id = p_member;
  END
  $$;
--> statement-breakpoint

-- A person who signed in starts a circle: they are its organizer, and the
-- parent it cares for is its first member. At most five active circles each.
CREATE FUNCTION kin_private.create_circle(
  p_name text, p_timezone text, p_currency text, p_parent_name text, p_parent_level public.parent_level, p_relationship text
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_user public.users;
    v_circle uuid := gen_random_uuid();
    v_organizer uuid := gen_random_uuid();
  BEGIN
    SELECT * INTO v_user FROM public.users WHERE id = kin_private.user_id() AND kind = 'person';
    IF v_user.id IS NULL THEN
      RAISE EXCEPTION 'kin: only a person who signed in can start a circle' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF (SELECT count(*) FROM public.members m JOIN public.circles c ON c.id = m.circle_id
        WHERE m.user_id = v_user.id AND m.role = 'organizer' AND m.status = 'active' AND c.status = 'active') >= 5 THEN
      RAISE EXCEPTION 'kin: a person may organize at most five circles' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
      RAISE EXCEPTION 'kin: % is not a timezone', p_timezone USING ERRCODE = 'check_violation';
    END IF;
    IF length(trim(coalesce(p_parent_name, ''))) = 0 THEN
      RAISE EXCEPTION 'kin: the parent needs a name' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.circles (id, name, timezone, currency, demo) VALUES (v_circle, trim(p_name), p_timezone, p_currency, false);
    INSERT INTO public.members (id, circle_id, user_id, display_name, role, relationship)
      VALUES (v_organizer, v_circle, v_user.id, v_user.name, 'organizer', nullif(trim(coalesce(p_relationship, '')), ''));
    INSERT INTO public.members (id, circle_id, display_name, role, parent_level)
      VALUES (gen_random_uuid(), v_circle, trim(p_parent_name), 'parent', p_parent_level);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, origin)
      VALUES (gen_random_uuid(), v_circle, 'member', v_organizer, 'circle.created', 'circle', v_circle, 'web');
    RETURN v_circle;
  END
  $$;
--> statement-breakpoint

-- A person joins the real circles that invited their verified address.
CREATE FUNCTION kin_private.accept_my_invitations() RETURNS integer
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
        v_member := gen_random_uuid();
        INSERT INTO public.members (id, circle_id, user_id, display_name, role, parent_level)
          VALUES (v_member, v_invitation.circle_id, v_user.id, v_user.name, v_invitation.role,
                  CASE WHEN v_invitation.role = 'parent' THEN 'decides'::public.parent_level END);
        INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, origin)
          VALUES (gen_random_uuid(), v_invitation.circle_id, 'member', v_member, 'invitation.accepted', 'invitation', v_invitation.id, 'web');
        v_joined := v_joined + 1;
      END IF;
      UPDATE public.invitations SET status = 'accepted', answered_at = now() WHERE id = v_invitation.id;
    END LOOP;
    RETURN v_joined;
  END
  $$;
--> statement-breakpoint

-- Answering a proposal. The member answers in their own seat and role, and
-- only roles that approve may answer (section 7.5).
CREATE FUNCTION kin_private.answers_proposals(p_circle uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(kin_private.my_role(p_circle) IN ('organizer', 'contributor', 'parent'), false) $$;

CREATE POLICY app_answer ON public.approvals FOR INSERT TO kin_app
  WITH CHECK (
    kin_private.answers_proposals(circle_id)
    AND member_id = kin_private.my_member_id(circle_id)
    AND role = kin_private.my_role(circle_id)
    AND EXISTS (SELECT 1 FROM public.proposals p WHERE p.id = proposal_id AND p.circle_id = approvals.circle_id AND p.state = 'pending_approval')
  );
GRANT INSERT ON public.approvals TO kin_app;

-- Moving a proposal on once the approval engine has decided. A person may
-- only close a pending proposal, and the database asks for the answers that
-- such a decision needs.
CREATE POLICY app_decide ON public.proposals FOR UPDATE TO kin_app
  USING (kin_private.answers_proposals(circle_id))
  WITH CHECK (kin_private.answers_proposals(circle_id));
GRANT UPDATE (state) ON public.proposals TO kin_app;

CREATE FUNCTION kin_private.assert_person_decision() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    -- Kin's own service runs the executions; this guards what a person may
    -- do. The function runs as its owner, so it asks who connected.
    IF session_user <> 'kin_app' THEN
      RETURN NEW;
    END IF;
    IF NOT (OLD.state = 'pending_approval' AND NEW.state IN ('approved', 'rejected', 'expired')) THEN
      RAISE EXCEPTION 'kin: a person cannot move a proposal from % to %', OLD.state, NEW.state
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.state = 'approved' AND NOT EXISTS (
      SELECT 1 FROM public.approvals a WHERE a.proposal_id = NEW.id AND a.decision = 'approve'
    ) THEN
      RAISE EXCEPTION 'kin: proposal % has no yes to be approved with', NEW.id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.state = 'rejected' AND NOT EXISTS (
      SELECT 1 FROM public.approvals a WHERE a.proposal_id = NEW.id AND a.decision = 'reject'
    ) THEN
      RAISE EXCEPTION 'kin: proposal % has no no to be rejected with', NEW.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER person_decision BEFORE UPDATE OF state ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_person_decision();
--> statement-breakpoint

-- The pause switch (section 15.3): any member but an observer pauses for at
-- most 24 hours on the circle's clock, in their own name. The organizer or the
-- member who paused may lift it early.
CREATE POLICY app_pause ON public.circles FOR UPDATE TO kin_app
  USING (kin_private.is_member(id) AND kin_private.my_role(id) <> 'observer')
  WITH CHECK (kin_private.is_member(id) AND (paused_by IS NULL OR paused_by = kin_private.my_member_id(id)));
GRANT UPDATE (paused_until, paused_by) ON public.circles TO kin_app;

CREATE FUNCTION kin_private.assert_pause_rules() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_now timestamptz := coalesce(NEW.clock_at, now());
  BEGIN
    IF session_user <> 'kin_app' THEN
      RETURN NEW;
    END IF;
    IF NEW.paused_until IS NOT NULL AND NEW.paused_until > v_now + interval '24 hours 1 minute' THEN
      RAISE EXCEPTION 'kin: a pause lasts at most 24 hours' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.paused_until IS NULL AND OLD.paused_by IS NOT NULL
       AND OLD.paused_by IS DISTINCT FROM kin_private.my_member_id(NEW.id)
       AND kin_private.my_role(NEW.id) <> 'organizer' THEN
      RAISE EXCEPTION 'kin: only the organizer or the member who paused may lift a pause' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER pause_rules BEFORE UPDATE OF paused_until, paused_by ON public.circles
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_pause_rules();
--> statement-breakpoint

-- An organizer invites someone to a role.
CREATE POLICY app_invite ON public.invitations FOR INSERT TO kin_app
  WITH CHECK (kin_private.is_organizer(circle_id) AND invited_by = kin_private.my_member_id(circle_id) AND status = 'pending');
GRANT INSERT ON public.invitations TO kin_app;

-- Every member action is written down, in the member's own name.
CREATE POLICY app_record ON public.audit_log FOR INSERT TO kin_app
  WITH CHECK (actor = 'member' AND kin_private.is_member(circle_id) AND member_id = kin_private.my_member_id(circle_id));
GRANT INSERT ON public.audit_log TO kin_app;
--> statement-breakpoint

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA kin_private FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA kin_private TO kin_app, kin_service, kin_provisioner;

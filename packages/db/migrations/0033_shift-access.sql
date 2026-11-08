-- Paid care shifts: who may see and change a shift, and how one gets paid.
-- Tables shifts, shift_permissions and shift_permission_uses, and the wallet
-- and shift-rule columns, come from the generated migration before this one;
-- this file adds their access rules, the shift state machine, the operations
-- that write them and the extensions of the payout path.
--
-- A shift is paid when two independent keys turn: the caregiver's own check-in
-- and check-out, and the family's word. Plain code in packages/domain prices
-- it and decides whether the parent's standing permission covers it; the
-- database prices it again from the two taps and refuses any plan or amount
-- that disagrees, so no query can skip the rule.
--
-- Refusals that screens word, by SQLSTATE:
--   KS001  the member cannot take this kind of shift
--   KS002  the shift is closed (cancelled) or not in a state that allows this
--   KS003  the visit is shorter than a minute
--   KS004  the visit is longer than 24 hours
--   KS005  nobody gives the family's word for their own shift
--   KS006  the parent can answer, so a sibling's word does not count
--   KS007  the visit has not begun, so there is nothing to confirm yet
--   KS008  only an aide's shift is paid
--   KS009  the shift is not confirmed: one of its two keys is missing
--   KB001 no caregiver rate, KB004 key reused, KB006 above the ceiling, KB007 paused,
--   KB008 no agreement, KB009 a payment to this caregiver is in progress,
--   KM001 only the parent grants, KM002 no parent, KM010 the shift does not fit the permission.
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_permission_uses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Like every circle table: the service acts for the circle it names, and the
-- provisioner fills the circle it is creating. Everyone but a caregiver reads
-- the whole calendar; a caregiver reads only the shifts they are on. The
-- parent's permissions are the family's money, so a caregiver sees none.
CREATE POLICY service_own_circle ON public.shifts FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY service_own_circle ON public.shift_permissions FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY service_own_circle ON public.shift_permission_uses FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY provisioner_new_circle ON public.shifts FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
CREATE POLICY provisioner_new_circle ON public.shift_permissions FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
CREATE POLICY provisioner_new_circle ON public.shift_permission_uses FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
CREATE POLICY app_member_read ON public.shifts FOR SELECT TO kin_app
  USING (kin_private.is_member(circle_id) AND (kin_private.sees_circle_money(circle_id) OR member_id = kin_private.my_member_id(circle_id)));
CREATE POLICY app_member_read ON public.shift_permissions FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));
CREATE POLICY app_member_read ON public.shift_permission_uses FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));
--> statement-breakpoint

-- Only the operations below write a shift or a permission. The worker reads
-- them, and moves a priced shift to paid once PayPal has paid it: the state
-- column and nothing else, and the trigger below checks the proposal settled.
GRANT SELECT ON public.shifts, public.shift_permissions, public.shift_permission_uses TO kin_app, kin_service;
GRANT UPDATE (state) ON public.shifts TO kin_service;
GRANT INSERT ON public.shifts, public.shift_permissions, public.shift_permission_uses TO kin_provisioner;
--> statement-breakpoint

-- The shift state machine, checked against packages/domain by a test.
INSERT INTO kin_private.state_transitions (machine, from_state, to_state) VALUES
  ('shift', 'scheduled', 'checked_in'),
  ('shift', 'scheduled', 'cancelled'),
  ('shift', 'checked_in', 'checked_out'),
  ('shift', 'checked_in', 'confirmed'),
  ('shift', 'checked_in', 'cancelled'),
  ('shift', 'checked_out', 'confirmed'),
  ('shift', 'checked_out', 'cancelled'),
  ('shift', 'confirmed', 'priced'),
  ('shift', 'priced', 'paid');

CREATE TRIGGER state_moves_forward BEFORE UPDATE OF state ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_transition('shift');
--> statement-breakpoint

-- What a shift is, and every key once turned, never changes; and each key
-- turns only on the move that is allowed to turn it: the check-in with the
-- move to checked_in, the check-out on the way out of it, the family's word
-- while the visit is open, the price and its proposal on the move to priced.
-- A shift is paid only after its proposal settled, which only PayPal's record
-- brings about.
CREATE FUNCTION kin_private.assert_shift_keys_fixed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF (to_jsonb(NEW) - ARRAY['state', 'checked_in_at', 'checked_out_at', 'family_confirmed_by', 'family_confirmed_at', 'family_confirmation',
                              'worked_minutes', 'billable_minutes', 'rate_cents_per_hour', 'cents', 'proposal_id', 'permission_id'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state', 'checked_in_at', 'checked_out_at', 'family_confirmed_by', 'family_confirmed_at', 'family_confirmation',
                                               'worked_minutes', 'billable_minutes', 'rate_cents_per_hour', 'cents', 'proposal_id', 'permission_id']) THEN
      RAISE EXCEPTION 'kin: shift % cannot change what it is after it is scheduled', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF (OLD.checked_in_at IS NOT NULL AND NEW.checked_in_at IS DISTINCT FROM OLD.checked_in_at)
       OR (OLD.checked_out_at IS NOT NULL AND NEW.checked_out_at IS DISTINCT FROM OLD.checked_out_at)
       OR (OLD.family_confirmed_at IS NOT NULL AND (NEW.family_confirmed_at IS DISTINCT FROM OLD.family_confirmed_at
           OR NEW.family_confirmed_by IS DISTINCT FROM OLD.family_confirmed_by OR NEW.family_confirmation IS DISTINCT FROM OLD.family_confirmation))
       OR (OLD.proposal_id IS NOT NULL AND (NEW.proposal_id IS DISTINCT FROM OLD.proposal_id OR NEW.permission_id IS DISTINCT FROM OLD.permission_id
           OR NEW.cents IS DISTINCT FROM OLD.cents OR NEW.worked_minutes IS DISTINCT FROM OLD.worked_minutes
           OR NEW.billable_minutes IS DISTINCT FROM OLD.billable_minutes OR NEW.rate_cents_per_hour IS DISTINCT FROM OLD.rate_cents_per_hour)) THEN
      RAISE EXCEPTION 'kin: a key of shift % has turned and cannot change', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF (OLD.checked_in_at IS NULL AND NEW.checked_in_at IS NOT NULL AND NOT (OLD.state = 'scheduled' AND NEW.state = 'checked_in'))
       OR (OLD.checked_out_at IS NULL AND NEW.checked_out_at IS NOT NULL AND NOT (OLD.state = 'checked_in' AND NEW.state IN ('checked_out', 'confirmed')))
       OR (OLD.family_confirmed_at IS NULL AND NEW.family_confirmed_at IS NOT NULL
           AND NOT (OLD.state IN ('checked_in', 'checked_out') AND NEW.state IN (OLD.state, 'confirmed')))
       OR (OLD.proposal_id IS NULL AND NEW.proposal_id IS NOT NULL AND NOT (OLD.state = 'confirmed' AND NEW.state = 'priced')) THEN
      RAISE EXCEPTION 'kin: shift % cannot turn that key now', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.state = 'paid' AND OLD.state <> 'paid' AND NOT EXISTS (
      SELECT 1 FROM public.proposals p WHERE p.circle_id = NEW.circle_id AND p.id = NEW.proposal_id AND p.state = 'settled'
    ) THEN
      RAISE EXCEPTION 'kin: shift % is paid only once its payment settled', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER keys_fixed BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_shift_keys_fixed();

-- A permission's terms are fixed once granted and only its status moves, exactly as a mandate's.
CREATE TRIGGER terms_fixed BEFORE UPDATE ON public.shift_permissions
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_mandate_terms_fixed();
--> statement-breakpoint

-- Putting a shift on the calendar. An organizer, a contributor or the parent
-- may. An aide's shift names an active caregiver who has an agreed rate, and
-- is the only kind that is paid; the others take any active member but an
-- observer. A retry with the same ID and the same facts returns the shift.
CREATE FUNCTION kin_private.schedule_shift(
  p_circle uuid, p_id uuid, p_kind text, p_member uuid, p_title text, p_starts timestamptz, p_ends timestamptz
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_me uuid := kin_private.my_member_id(p_circle);
    v_who public.members;
    v_payee uuid;
    v_existing public.shifts;
    v_title text := nullif(trim(coalesce(p_title, '')), '');
  BEGIN
    IF v_role IS NULL OR v_role NOT IN ('organizer', 'contributor', 'parent') OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: scheduling a shift refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_who FROM public.members WHERE circle_id = p_circle AND id = p_member AND status = 'active';
    IF v_who.id IS NULL THEN
      RAISE EXCEPTION 'kin: scheduling a shift refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_existing FROM public.shifts WHERE circle_id = p_circle AND id = p_id;
    IF FOUND THEN
      IF v_existing.kind = p_kind AND v_existing.member_id = p_member AND v_existing.title IS NOT DISTINCT FROM v_title
         AND v_existing.starts_at = p_starts AND v_existing.ends_at = p_ends THEN
        RETURN p_id;
      END IF;
      RAISE EXCEPTION 'kin: shift key reused' USING ERRCODE = 'KB004';
    END IF;
    IF p_kind IS NULL OR p_kind NOT IN ('aide', 'visit', 'appointment', 'drive') THEN
      RAISE EXCEPTION 'kin: not a kind of shift' USING ERRCODE = 'check_violation';
    END IF;
    IF p_kind = 'aide' THEN
      IF v_who.role <> 'caregiver' THEN
        RAISE EXCEPTION 'kin: an aide shift is for a caregiver' USING ERRCODE = 'KS001';
      END IF;
      SELECT id INTO v_payee FROM public.payees WHERE circle_id = p_circle AND member_id = p_member AND caregiver_rate_cents_per_hour IS NOT NULL;
      IF v_payee IS NULL THEN
        RAISE EXCEPTION 'kin: no caregiver rate' USING ERRCODE = 'KB001';
      END IF;
    ELSIF v_who.role = 'observer' THEN
      RAISE EXCEPTION 'kin: an observer takes no shift' USING ERRCODE = 'KS001';
    END IF;
    INSERT INTO public.shifts (id, circle_id, kind, title, member_id, payee_id, starts_at, ends_at, created_by)
      VALUES (p_id, p_circle, p_kind, v_title, p_member, v_payee, p_starts, p_ends, v_me);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'shift.scheduled', 'shift', p_id,
              jsonb_build_object('kind', p_kind, 'memberId', p_member), 'web');
    RETURN p_id;
  END
  $$;
--> statement-breakpoint

-- The caregiver's own key: only the member the shift is for turns it, on the
-- circle's clock, never on a time they send. Saying it again changes nothing.
-- A demo circle's clock stands still, so a demo check-out is stamped at the
-- planned end (or the clock, if later) instead of the same instant as the check-in.
CREATE FUNCTION kin_private.check_in_shift(p_circle uuid, p_shift uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_shift public.shifts;
    v_now timestamptz;
    v_demo boolean;
  BEGIN
    SELECT s.* INTO v_shift FROM public.shifts s JOIN public.circles c ON c.id = s.circle_id AND c.status = 'active'
      WHERE s.circle_id = p_circle AND s.id = p_shift FOR UPDATE OF s;
    IF NOT FOUND OR v_me IS NULL OR v_shift.member_id <> v_me THEN
      RAISE EXCEPTION 'kin: shift check-in refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_shift.checked_in_at IS NOT NULL THEN
      RETURN;
    END IF;
    IF v_shift.state <> 'scheduled' THEN
      RAISE EXCEPTION 'kin: the shift is closed' USING ERRCODE = 'KS002';
    END IF;
    SELECT date_trunc('second', coalesce(c.clock_at, now())), c.demo INTO v_now, v_demo FROM public.circles c WHERE c.id = p_circle;
    -- A real visit is tapped in around the time it was planned for, so a tap
    -- cannot be made weeks ahead, or long after, to be paid for later. A demo
    -- circle's clock stands still and is simulated, so it has no such window.
    IF NOT v_demo AND v_now < v_shift.starts_at - interval '2 hours' THEN
      RAISE EXCEPTION 'kin: the visit has not begun' USING ERRCODE = 'KS007';
    END IF;
    IF NOT v_demo AND v_now > v_shift.ends_at + interval '2 hours' THEN
      RAISE EXCEPTION 'kin: the shift is closed' USING ERRCODE = 'KS002';
    END IF;
    UPDATE public.shifts SET state = 'checked_in', checked_in_at = v_now WHERE circle_id = p_circle AND id = p_shift;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'shift.checked_in', 'shift', p_shift, '{}'::jsonb, 'web');
  END
  $$;
--> statement-breakpoint

-- The end of the caregiver's key. When the family's word is already in, the
-- shift is confirmed in the same statement; otherwise it waits for the word.
CREATE FUNCTION kin_private.check_out_shift(p_circle uuid, p_shift uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_shift public.shifts;
    v_circle public.circles;
    v_out timestamptz;
  BEGIN
    SELECT s.* INTO v_shift FROM public.shifts s JOIN public.circles c ON c.id = s.circle_id AND c.status = 'active'
      WHERE s.circle_id = p_circle AND s.id = p_shift FOR UPDATE OF s;
    IF NOT FOUND OR v_me IS NULL OR v_shift.member_id <> v_me THEN
      RAISE EXCEPTION 'kin: shift check-out refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_shift.checked_out_at IS NOT NULL THEN
      RETURN;
    END IF;
    IF v_shift.state <> 'checked_in' THEN
      RAISE EXCEPTION 'kin: the shift is not under way' USING ERRCODE = 'KS002';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle;
    v_out := date_trunc('second', coalesce(v_circle.clock_at, now()));
    IF v_circle.demo THEN
      v_out := least(greatest(v_out, v_shift.ends_at, v_shift.checked_in_at + interval '1 minute'), v_shift.checked_in_at + interval '24 hours');
    END IF;
    IF v_out < v_shift.checked_in_at + interval '1 minute' THEN
      RAISE EXCEPTION 'kin: a visit under a minute is not a visit' USING ERRCODE = 'KS003';
    END IF;
    IF v_out - v_shift.checked_in_at > interval '24 hours' THEN
      RAISE EXCEPTION 'kin: a visit cannot last more than 24 hours' USING ERRCODE = 'KS004';
    END IF;
    UPDATE public.shifts
      SET state = CASE WHEN v_shift.family_confirmed_at IS NOT NULL THEN 'confirmed'::public.shift_state ELSE 'checked_out'::public.shift_state END,
          checked_out_at = v_out
      WHERE circle_id = p_circle AND id = p_shift;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'shift.checked_out', 'shift', p_shift,
              jsonb_build_object('confirmed', v_shift.family_confirmed_at IS NOT NULL), 'web');
  END
  $$;
--> statement-breakpoint

-- The family's key. The parent's word always counts. An organizer's or a
-- contributor's counts only where no active parent takes part in decisions
-- herself, or in a demo circle where the organizer stands in for her; nobody
-- gives it for their own shift; a caregiver and an observer never do. It may
-- come while the visit is under way or after it; if the caregiver's key has
-- already turned, the shift is confirmed in the same statement. Saying it
-- again changes nothing.
CREATE FUNCTION kin_private.confirm_shift(p_circle uuid, p_shift uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_me uuid := kin_private.my_member_id(p_circle);
    v_shift public.shifts;
    v_circle public.circles;
    v_parent_decides boolean;
    v_now timestamptz;
  BEGIN
    IF v_role IS NULL OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: confirming a shift refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    SELECT * INTO v_shift FROM public.shifts WHERE circle_id = p_circle AND id = p_shift FOR UPDATE;
    IF v_circle.id IS NULL OR v_shift.id IS NULL THEN
      RAISE EXCEPTION 'kin: confirming a shift refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_shift.member_id = v_me THEN
      RAISE EXCEPTION 'kin: nobody confirms their own shift' USING ERRCODE = 'KS005';
    END IF;
    IF v_role NOT IN ('parent', 'organizer', 'contributor') THEN
      RAISE EXCEPTION 'kin: confirming a shift refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_parent_decides := EXISTS (
      SELECT 1 FROM public.members WHERE circle_id = p_circle AND role = 'parent' AND status = 'active' AND parent_level = 'decides'
    );
    IF v_role <> 'parent' AND v_parent_decides AND NOT v_circle.demo THEN
      RAISE EXCEPTION 'kin: the parent can give her own word' USING ERRCODE = 'KS006';
    END IF;
    IF v_shift.family_confirmed_at IS NOT NULL THEN
      RETURN;
    END IF;
    IF v_shift.state = 'cancelled' THEN
      RAISE EXCEPTION 'kin: the shift is closed' USING ERRCODE = 'KS002';
    END IF;
    IF v_shift.state = 'scheduled' THEN
      RAISE EXCEPTION 'kin: the visit has not begun' USING ERRCODE = 'KS007';
    END IF;
    v_now := date_trunc('second', coalesce(v_circle.clock_at, now()));
    UPDATE public.shifts
      SET family_confirmed_by = v_me, family_confirmed_at = v_now,
          family_confirmation = CASE WHEN v_role = 'parent' THEN 'parent' ELSE 'sibling' END,
          state = CASE WHEN v_shift.checked_out_at IS NOT NULL THEN 'confirmed'::public.shift_state ELSE v_shift.state END
      WHERE circle_id = p_circle AND id = p_shift;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'shift.confirmed', 'shift', p_shift,
              jsonb_build_object('confirmation', CASE WHEN v_role = 'parent' THEN 'parent' ELSE 'sibling' END), 'web');
  END
  $$;
--> statement-breakpoint

-- Calling a shift off, before both keys have turned: the member it is for, an
-- organizer or the parent. A confirmed shift is priced, never cancelled.
CREATE FUNCTION kin_private.cancel_shift(p_circle uuid, p_shift uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_me uuid := kin_private.my_member_id(p_circle);
    v_shift public.shifts;
  BEGIN
    SELECT s.* INTO v_shift FROM public.shifts s JOIN public.circles c ON c.id = s.circle_id AND c.status = 'active'
      WHERE s.circle_id = p_circle AND s.id = p_shift FOR UPDATE OF s;
    IF NOT FOUND OR v_role IS NULL OR v_me IS NULL OR NOT (v_shift.member_id = v_me OR v_role IN ('organizer', 'parent')) THEN
      RAISE EXCEPTION 'kin: cancelling a shift refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_shift.state = 'cancelled' THEN
      RETURN;
    END IF;
    IF v_shift.state NOT IN ('scheduled', 'checked_in', 'checked_out') THEN
      RAISE EXCEPTION 'kin: the shift can no longer be cancelled' USING ERRCODE = 'KS002';
    END IF;
    UPDATE public.shifts SET state = 'cancelled' WHERE circle_id = p_circle AND id = p_shift;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'shift.cancelled', 'shift', p_shift, jsonb_build_object('from', v_shift.state), 'web');
  END
  $$;
--> statement-breakpoint

-- The pay rules a family agreed for one caregiver: the least a visit is paid
-- for, and the minutes after which the rest is overtime at a percent of the
-- rate. Only an organizer sets them, for a caregiver who has a rate.
CREATE FUNCTION kin_private.set_shift_rules(p_circle uuid, p_payee uuid, p_min integer, p_ot_after integer, p_ot_percent integer) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NOT coalesce(kin_private.is_organizer(p_circle), false) THEN
      RAISE EXCEPTION 'kin: shift rules refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM 1 FROM public.payees p JOIN public.members m ON m.circle_id = p.circle_id AND m.id = p.member_id
      WHERE p.circle_id = p_circle AND p.id = p_payee AND p.caregiver_rate_cents_per_hour IS NOT NULL AND m.role = 'caregiver' AND m.status = 'active'
      FOR UPDATE OF p;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: shift rules refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE public.payees SET shift_minimum_minutes = p_min, shift_overtime_after_minutes = p_ot_after, shift_overtime_percent = p_ot_percent
      WHERE circle_id = p_circle AND id = p_payee;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', kin_private.my_member_id(p_circle), 'shift_rules.set', 'payee', p_payee,
              jsonb_build_object('minimumMinutes', p_min, 'overtimeAfterMinutes', p_ot_after, 'overtimePercent', p_ot_percent), 'web');
  END
  $$;
--> statement-breakpoint

-- Recording the parent's permission to pay a caregiver's confirmed shifts, as
-- a mandate is recorded: the parent grants in their own name; in a demo circle
-- the organizer plays her spoken yes and the row says simulated; in a real
-- circle only the parent can. The per-shift limit may not exceed the
-- agreement's ceiling, and the database seals the terms with a digest. A retry
-- with the same ID returns the permission already granted.
CREATE FUNCTION kin_private.grant_shift_permission(
  p_circle uuid, p_id uuid, p_payee uuid, p_max_minutes integer, p_per_shift bigint, p_valid_from date, p_expires_on date, p_spoken text
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_member uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_agreement public.agreements;
    v_existing public.shift_permissions;
    v_parent uuid;
    v_now timestamptz;
  BEGIN
    IF v_role IS NULL OR v_role NOT IN ('parent', 'organizer') THEN
      RAISE EXCEPTION 'kin: granting a shift permission refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    IF v_circle.id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.payees p JOIN public.members m ON m.circle_id = p.circle_id AND m.id = p.member_id
      WHERE p.circle_id = p_circle AND p.id = p_payee AND p.caregiver_rate_cents_per_hour IS NOT NULL AND m.role = 'caregiver' AND m.status = 'active'
    ) THEN
      RAISE EXCEPTION 'kin: granting a shift permission refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_role = 'organizer' AND NOT v_circle.demo THEN
      RAISE EXCEPTION 'kin: only the parent grants a shift permission' USING ERRCODE = 'KM001';
    END IF;
    SELECT * INTO v_existing FROM public.shift_permissions WHERE circle_id = p_circle AND id = p_id;
    IF FOUND THEN
      IF v_existing.payee_id = p_payee AND v_existing.max_minutes_per_day = p_max_minutes AND v_existing.per_shift_cents = p_per_shift
         AND v_existing.valid_from = p_valid_from AND v_existing.expires_on = p_expires_on THEN
        RETURN p_id;
      END IF;
      RAISE EXCEPTION 'kin: shift permission key reused' USING ERRCODE = 'KB004';
    END IF;
    v_parent := CASE WHEN v_role = 'parent' THEN v_member
      ELSE (SELECT m.id FROM public.members m WHERE m.circle_id = p_circle AND m.role = 'parent' AND m.status = 'active' ORDER BY m.joined_at, m.id LIMIT 1) END;
    IF v_parent IS NULL THEN
      RAISE EXCEPTION 'kin: the circle has no parent to grant a shift permission' USING ERRCODE = 'KM002';
    END IF;
    SELECT * INTO v_agreement FROM kin_private.agreement_in_force(p_circle);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: the circle has no agreement to bound a shift permission' USING ERRCODE = 'KB008';
    END IF;
    IF p_per_shift > v_agreement.ceiling_cents THEN
      RAISE EXCEPTION 'kin: a shift permission cannot exceed the agreement''s ceiling' USING ERRCODE = 'KB006';
    END IF;
    v_now := coalesce(v_circle.clock_at, now());
    IF p_expires_on < (v_now AT TIME ZONE v_circle.timezone)::date THEN
      RAISE EXCEPTION 'kin: a shift permission cannot be granted already expired' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.shift_permissions (id, circle_id, payee_id, granted_by, recorded_by, max_minutes_per_day, per_shift_cents,
                                          valid_from, expires_on, status, spoken_text, evidence_ref, simulated, digest, granted_at)
      VALUES (p_id, p_circle, p_payee, v_parent, v_member, p_max_minutes, p_per_shift, p_valid_from, p_expires_on, 'active',
              nullif(trim(p_spoken), ''),
              CASE WHEN v_role = 'parent' THEN 'parent-confirmed:' || p_id::text ELSE 'demo-voice:' || p_id::text END,
              v_circle.demo,
              encode(sha256(convert_to(jsonb_build_array(p_payee::text, p_max_minutes, p_per_shift, p_valid_from::text, p_expires_on::text)::text, 'UTF8')), 'hex'),
              v_now);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_member, 'shift_permission.granted', 'shift_permission', p_id,
              jsonb_build_object('payeeId', p_payee, 'maxMinutesPerDay', p_max_minutes, 'perShiftCents', p_per_shift, 'simulated', v_circle.demo), 'web');
    RETURN p_id;
  END
  $$;
--> statement-breakpoint

-- Pausing holds a permission still and any member who answers may do it, since
-- stopping is always safe. Resuming or ending it is the parent's call (or, in a
-- demo circle, the organizer playing the parent).
CREATE FUNCTION kin_private.set_shift_permission_status(p_circle uuid, p_permission uuid, p_status public.mandate_status) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_demo boolean;
    v_now timestamptz;
  BEGIN
    SELECT c.demo, coalesce(c.clock_at, now()) INTO v_demo, v_now FROM public.circles c WHERE c.id = p_circle AND c.status = 'active';
    IF v_role IS NULL OR v_demo IS NULL OR v_role NOT IN ('organizer', 'contributor', 'parent')
       OR (p_status <> 'paused' AND NOT (v_role = 'parent' OR (v_role = 'organizer' AND v_demo))) THEN
      RAISE EXCEPTION 'kin: changing a shift permission refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM 1 FROM public.shift_permissions WHERE circle_id = p_circle AND id = p_permission FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: changing a shift permission refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE public.shift_permissions SET status = p_status, ended_at = CASE WHEN p_status = 'revoked' THEN v_now ELSE NULL END
      WHERE circle_id = p_circle AND id = p_permission;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', kin_private.my_member_id(p_circle), 'shift_permission.' || p_status::text, 'shift_permission', p_permission, '{}'::jsonb, 'web');
  END
  $$;
--> statement-breakpoint

-- Paying a shift whose two keys have turned. The caller never gives an
-- amount: the database works the price out again from the two taps and the
-- caregiver's agreed rate and rules, in whole cents with halves rounded up, as
-- packages/domain does, and stores it on the shift.
--
-- Then the plan decides. A plan of outcome "shift_permission" names the
-- parent's standing permission; the database re-checks every limit (live,
-- dates, caregiver, amount for a shift, hours already used that day) and, if the
-- shift fits, approves the proposal in this transaction with the permission
-- recorded as the approver, which queues the payout through the ordinary path
-- (0008, 0010, 0019). Any other plan must be the approval plan the agreement
-- asks for, and the family answers it on the usual screens. A retry returns
-- the proposal already raised.
CREATE FUNCTION kin_private.pay_shift(p_circle uuid, p_shift uuid, p_plan jsonb) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_shift public.shifts;
    v_payee public.payees;
    v_agreement public.agreements;
    v_perm public.shift_permissions;
    v_now timestamptz;
    v_worked integer;
    v_billable integer;
    v_regular integer;
    v_over integer;
    v_cents bigint;
    v_day date;
    v_today date;
    v_used bigint;
    v_expires timestamptz;
    v_first jsonb;
    v_slots jsonb;
    v_proposal uuid;
    v_by_permission boolean := jsonb_typeof(p_plan) = 'object' AND p_plan ->> 'outcome' = 'shift_permission';
  BEGIN
    IF v_role IS NULL OR v_role = 'observer' OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: paying a shift refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    SELECT * INTO v_shift FROM public.shifts WHERE circle_id = p_circle AND id = p_shift FOR UPDATE;
    IF v_circle.id IS NULL OR v_shift.id IS NULL OR (v_role = 'caregiver' AND v_shift.member_id <> v_me) THEN
      RAISE EXCEPTION 'kin: paying a shift refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_shift.proposal_id IS NOT NULL THEN
      RETURN v_shift.proposal_id;
    END IF;
    IF v_shift.kind <> 'aide' THEN
      RAISE EXCEPTION 'kin: only an aide''s shift is paid' USING ERRCODE = 'KS008';
    END IF;
    IF v_shift.state = 'cancelled' THEN
      RAISE EXCEPTION 'kin: the shift is closed' USING ERRCODE = 'KS002';
    END IF;
    IF v_shift.state <> 'confirmed' THEN
      RAISE EXCEPTION 'kin: the shift has not been confirmed by both keys' USING ERRCODE = 'KS009';
    END IF;
    SELECT p.* INTO v_payee FROM public.payees p JOIN public.members m ON m.circle_id = p.circle_id AND m.id = p.member_id
      WHERE p.circle_id = p_circle AND p.id = v_shift.payee_id AND m.role = 'caregiver' AND m.status = 'active' FOR UPDATE OF p;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: paying a shift refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_payee.caregiver_rate_cents_per_hour IS NULL THEN
      RAISE EXCEPTION 'kin: no caregiver rate' USING ERRCODE = 'KB001';
    END IF;
    SELECT * INTO v_agreement FROM kin_private.agreement_in_force(p_circle);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: the circle has no agreement to approve with' USING ERRCODE = 'KB008';
    END IF;
    v_now := coalesce(v_circle.clock_at, now());
    IF v_circle.paused_until IS NOT NULL AND v_circle.paused_until > v_now THEN
      RAISE EXCEPTION 'kin: the circle is paused' USING ERRCODE = 'KB007';
    END IF;

    -- The price, from the two taps: whole minutes between them, lifted to the
    -- minimum, with the minutes past the overtime line at the overtime rate.
    v_worked := floor(extract(epoch FROM (v_shift.checked_out_at - v_shift.checked_in_at)) / 60);
    IF v_worked < 1 THEN
      RAISE EXCEPTION 'kin: a visit under a minute is not a visit' USING ERRCODE = 'KS003';
    END IF;
    IF v_worked > 1440 THEN
      RAISE EXCEPTION 'kin: a visit cannot last more than 24 hours' USING ERRCODE = 'KS004';
    END IF;
    v_billable := greatest(v_worked, v_payee.shift_minimum_minutes);
    v_regular := least(v_billable, coalesce(v_payee.shift_overtime_after_minutes, v_billable));
    v_over := v_billable - v_regular;
    v_cents := floor((v_regular::numeric * v_payee.caregiver_rate_cents_per_hour + 30) / 60)
             + floor((v_over::numeric * floor((v_payee.caregiver_rate_cents_per_hour::numeric * v_payee.shift_overtime_percent + 50) / 100) + 30) / 60);
    IF v_cents > v_agreement.ceiling_cents THEN
      RAISE EXCEPTION 'kin: the shift is above the agreement''s ceiling' USING ERRCODE = 'KB006';
    END IF;
    v_day := (v_shift.checked_in_at AT TIME ZONE v_circle.timezone)::date;

    v_proposal := gen_random_uuid();
    IF v_by_permission THEN
      BEGIN
        SELECT * INTO v_perm FROM public.shift_permissions
          WHERE circle_id = p_circle AND id = (p_plan ->> 'permissionId')::uuid FOR UPDATE;
      EXCEPTION WHEN others THEN
        v_perm := NULL;
      END;
      IF p_plan - ARRAY['outcome', 'permissionId', 'agreementVersion'] <> '{}'::jsonb
         OR p_plan -> 'agreementVersion' IS DISTINCT FROM to_jsonb(v_agreement.version)
         OR v_perm.id IS NULL THEN
        RAISE EXCEPTION 'kin: the approval plan does not match the agreement' USING ERRCODE = 'check_violation';
      END IF;
      v_today := (v_now AT TIME ZONE v_circle.timezone)::date;
      SELECT coalesce(sum(u.minutes), 0) INTO v_used
        FROM public.shift_permission_uses u JOIN public.proposals p ON p.circle_id = u.circle_id AND p.id = u.proposal_id
        WHERE u.circle_id = p_circle AND u.permission_id = v_perm.id AND u.day = v_day
          AND p.state IN ('pending_approval', 'approved', 'executing', 'settled');
      IF v_perm.status <> 'active'
         OR v_today NOT BETWEEN v_perm.valid_from AND v_perm.expires_on
         OR v_day NOT BETWEEN v_perm.valid_from AND v_perm.expires_on
         OR v_perm.payee_id <> v_shift.payee_id
         OR v_cents > v_perm.per_shift_cents
         OR v_used + v_billable > v_perm.max_minutes_per_day THEN
        RAISE EXCEPTION 'kin: the shift does not fit the permission' USING ERRCODE = 'KM010';
      END IF;
      INSERT INTO public.proposals (id, circle_id, kind, cents, payee_id, purpose, raised_by, raised_at, state, expires_at, agreement_version, plan)
        VALUES (v_proposal, p_circle, 'caregiver_payout', v_cents, v_shift.payee_id, 'shift', NULL, v_now, 'pending_approval', NULL, v_agreement.version, p_plan);
      INSERT INTO public.shift_permission_uses (id, circle_id, permission_id, shift_id, proposal_id, cents, minutes, day)
        VALUES (gen_random_uuid(), p_circle, v_perm.id, p_shift, v_proposal, v_cents, v_billable, v_day);
      INSERT INTO public.approvals (id, circle_id, proposal_id, member_id, role, decision, method, evidence_ref, decided_at)
        VALUES (gen_random_uuid(), p_circle, v_proposal, v_perm.granted_by, 'parent', 'approve', 'mandate', 'shift_permission:' || v_perm.id::text, v_now);
      UPDATE public.proposals SET state = 'approved' WHERE circle_id = p_circle AND id = v_proposal;
    ELSE
      v_first := CASE WHEN EXISTS (
          SELECT 1 FROM public.members WHERE circle_id = p_circle AND role = 'parent' AND status = 'active' AND parent_level = 'decides'
        ) AND v_cents > v_agreement.parent_decides_above_cents
        THEN '{"reason": "parent_decides", "roles": ["parent"]}'::jsonb
        ELSE '{"reason": "organizer", "roles": ["organizer"]}'::jsonb END;
      v_slots := CASE WHEN v_cents > v_agreement.second_approval_above_cents
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
         OR p_plan ->> 'payeeMemberId' IS DISTINCT FROM v_payee.member_id::text
         OR p_plan -> 'announceToCircle' IS DISTINCT FROM to_jsonb(v_payee.status = 'new')
         OR v_expires IS NULL
         OR v_expires NOT BETWEEN v_now + interval '71 hours 55 minutes' AND v_now + interval '72 hours 5 minutes' THEN
        RAISE EXCEPTION 'kin: the approval plan does not match the agreement' USING ERRCODE = 'check_violation';
      END IF;
      INSERT INTO public.proposals (id, circle_id, kind, cents, payee_id, purpose, raised_by, raised_at, state, expires_at, agreement_version, plan)
        VALUES (v_proposal, p_circle, 'caregiver_payout', v_cents, v_shift.payee_id, 'shift', NULL, v_now, 'pending_approval', v_expires, v_agreement.version, p_plan);
    END IF;

    UPDATE public.shifts
      SET state = 'priced', worked_minutes = v_worked, billable_minutes = v_billable, rate_cents_per_hour = v_payee.caregiver_rate_cents_per_hour,
          cents = v_cents, proposal_id = v_proposal, permission_id = CASE WHEN v_by_permission THEN v_perm.id END
      WHERE circle_id = p_circle AND id = p_shift;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'shift.priced', 'shift', p_shift,
              jsonb_build_object('proposalId', v_proposal, 'cents', v_cents, 'minutes', v_billable, 'permissionId', CASE WHEN v_by_permission THEN v_perm.id END), 'web');
    RETURN v_proposal;
  END
  $$;
--> statement-breakpoint

-- What plain code needs to decide how a confirmed shift is paid, read for one
-- shift in one place: the caregiver's rate and pay rules, the agreement's
-- limits, whether a parent decides, the circle's clock, and the live standing
-- permissions for this caregiver with the minutes each has already used on the
-- shift's day. The shift's own caregiver may run the payment (their check-out can
-- be the last key to turn) but may not read the family's agreement or
-- permissions, so this function hands those to the server and to nobody else,
-- for the roles that may pay the shift. It changes nothing.
CREATE FUNCTION kin_private.shift_payment_facts(p_circle uuid, p_shift uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_shift public.shifts;
    v_payee public.payees;
    v_agreement public.agreements;
    v_now timestamptz;
    v_day date;
  BEGIN
    IF v_role IS NULL OR v_role = 'observer' OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: reading a shift''s payment facts refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    SELECT * INTO v_shift FROM public.shifts WHERE circle_id = p_circle AND id = p_shift;
    IF v_circle.id IS NULL OR v_shift.id IS NULL OR v_shift.payee_id IS NULL OR (v_role = 'caregiver' AND v_shift.member_id <> v_me) THEN
      RAISE EXCEPTION 'kin: reading a shift''s payment facts refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_payee FROM public.payees WHERE circle_id = p_circle AND id = v_shift.payee_id;
    SELECT * INTO v_agreement FROM kin_private.agreement_in_force(p_circle);
    v_now := coalesce(v_circle.clock_at, now());
    v_day := (v_shift.checked_in_at AT TIME ZONE v_circle.timezone)::date;
    RETURN jsonb_build_object(
      'now', v_now,
      'timezone', v_circle.timezone,
      'pausedUntil', v_circle.paused_until,
      'today', (v_now AT TIME ZONE v_circle.timezone)::date,
      'day', v_day,
      'parentDecides', EXISTS (SELECT 1 FROM public.members WHERE circle_id = p_circle AND role = 'parent' AND status = 'active' AND parent_level = 'decides'),
      'payee', jsonb_build_object(
        'id', v_payee.id, 'memberId', v_payee.member_id, 'status', v_payee.status,
        'rateCentsPerHour', v_payee.caregiver_rate_cents_per_hour, 'minimumMinutes', v_payee.shift_minimum_minutes,
        'overtimeAfterMinutes', v_payee.shift_overtime_after_minutes, 'overtimePercent', v_payee.shift_overtime_percent),
      'agreement', CASE WHEN v_agreement.id IS NULL THEN NULL ELSE jsonb_build_object(
        'version', v_agreement.version, 'ceilingCents', v_agreement.ceiling_cents,
        'secondApprovalAboveCents', v_agreement.second_approval_above_cents, 'parentDecidesAboveCents', v_agreement.parent_decides_above_cents) END,
      'permissions', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', sp.id, 'payeeId', sp.payee_id, 'status', sp.status, 'maxMinutesPerDay', sp.max_minutes_per_day,
          'perShiftCents', sp.per_shift_cents, 'validFrom', sp.valid_from, 'expiresOn', sp.expires_on,
          'minutesUsedThatDay', (
            SELECT coalesce(sum(u.minutes), 0) FROM public.shift_permission_uses u JOIN public.proposals p ON p.circle_id = u.circle_id AND p.id = u.proposal_id
            WHERE u.circle_id = p_circle AND u.permission_id = sp.id AND u.day = v_day
              AND p.state IN ('pending_approval', 'approved', 'executing', 'settled')))
          ORDER BY sp.created_at, sp.id)
        FROM public.shift_permissions sp
        WHERE sp.circle_id = p_circle AND sp.payee_id = v_shift.payee_id AND sp.status IN ('active', 'paused')), '[]'::jsonb)
    );
  END
  $$;
--> statement-breakpoint

-- A proposal paid under a shift permission carries a plan of outcome
-- "shift_permission" and the approval the permission itself recorded, with a
-- use of the permission; nothing else may approve it. Every other plan,
-- including a mandate's, is checked exactly as before (0021).
CREATE OR REPLACE FUNCTION kin_private.assert_person_decision() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_now timestamptz;
    v_demo boolean;
    v_slots integer;
    v_payee text := NEW.plan ->> 'payeeMemberId';
  BEGIN
    -- Kin's own service runs the executions; this guards what a person may
    -- do. The function runs as its owner, so it asks who connected.
    IF session_user <> 'kin_app' THEN
      RETURN NEW;
    END IF;
    SELECT c.demo, coalesce(c.clock_at, now()) INTO v_demo, v_now FROM public.circles c WHERE c.id = NEW.circle_id;
    IF NOT (OLD.state = 'pending_approval' AND NEW.state IN ('approved', 'rejected', 'expired')) THEN
      RAISE EXCEPTION 'kin: a person cannot move a proposal from % to %', OLD.state, NEW.state
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NEW.state = 'approved' AND NEW.plan ->> 'outcome' = 'mandate' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.approvals a JOIN public.mandates m ON m.circle_id = a.circle_id AND m.granted_by = a.member_id
        WHERE a.proposal_id = NEW.id AND a.decision = 'approve' AND a.method::text = 'mandate' AND a.evidence_ref = 'mandate:' || m.id::text
          AND m.id::text = NEW.plan ->> 'mandateId'
      ) OR NOT EXISTS (
        SELECT 1 FROM public.mandate_uses u WHERE u.proposal_id = NEW.id AND u.mandate_id::text = NEW.plan ->> 'mandateId'
      ) OR EXISTS (SELECT 1 FROM public.approvals a WHERE a.proposal_id = NEW.id AND a.decision = 'reject') THEN
        RAISE EXCEPTION 'kin: proposal % is not covered by a mandate', NEW.id USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.state = 'approved' AND NEW.plan ->> 'outcome' = 'shift_permission' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.approvals a JOIN public.shift_permissions sp ON sp.circle_id = a.circle_id AND sp.granted_by = a.member_id
        WHERE a.proposal_id = NEW.id AND a.decision = 'approve' AND a.method::text = 'mandate' AND a.evidence_ref = 'shift_permission:' || sp.id::text
          AND sp.id::text = NEW.plan ->> 'permissionId'
      ) OR NOT EXISTS (
        SELECT 1 FROM public.shift_permission_uses u WHERE u.proposal_id = NEW.id AND u.permission_id::text = NEW.plan ->> 'permissionId'
      ) OR EXISTS (SELECT 1 FROM public.approvals a WHERE a.proposal_id = NEW.id AND a.decision = 'reject') THEN
        RAISE EXCEPTION 'kin: proposal % is not covered by a shift permission', NEW.id USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.state = 'approved' THEN
      -- The plan stored when the proposal was raised says how many places
      -- need a yes. Each must be a different member, nobody may have said no,
      -- and the member being paid may not be the only one to say yes.
      IF NEW.plan ->> 'outcome' IS DISTINCT FROM 'needs_approval' THEN
        RAISE EXCEPTION 'kin: proposal % has no plan that waits for approval', NEW.id USING ERRCODE = 'check_violation';
      END IF;
      v_slots := jsonb_array_length(NEW.plan -> 'slots');
      IF EXISTS (SELECT 1 FROM public.approvals a WHERE a.proposal_id = NEW.id AND a.decision = 'reject') THEN
        RAISE EXCEPTION 'kin: proposal % has a no, so it cannot be approved', NEW.id USING ERRCODE = 'check_violation';
      END IF;
      IF (SELECT count(DISTINCT a.member_id) FROM public.approvals a WHERE a.proposal_id = NEW.id AND a.decision = 'approve') < v_slots THEN
        RAISE EXCEPTION 'kin: proposal % needs % yeses', NEW.id, v_slots USING ERRCODE = 'check_violation';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.approvals a
        WHERE a.proposal_id = NEW.id AND a.decision = 'approve' AND a.member_id::text IS DISTINCT FROM v_payee
      ) THEN
        RAISE EXCEPTION 'kin: the member being paid cannot be the only one to approve proposal %', NEW.id
          USING ERRCODE = 'check_violation';
      END IF;
      IF NOT v_demo AND EXISTS (
        SELECT 1 FROM public.approvals a
        WHERE a.proposal_id = NEW.id AND a.decision = 'approve' AND coalesce(a.evidence_ref, '') !~ '^cognito:[^:]+:[0-9]+:'
      ) THEN
        RAISE EXCEPTION 'kin: approving real money needs a fresh multi-factor check' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;

    IF NEW.state = 'rejected' AND NOT EXISTS (
      SELECT 1 FROM public.approvals a WHERE a.proposal_id = NEW.id AND a.decision = 'reject'
    ) THEN
      RAISE EXCEPTION 'kin: proposal % has no no to be rejected with', NEW.id USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.state = 'expired' AND (NEW.expires_at IS NULL OR NEW.expires_at > v_now) THEN
      RAISE EXCEPTION 'kin: proposal % has not expired yet', NEW.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

-- An approved payout is carried out like any other: an execution keyed by the
-- proposal, and an outbox message for the worker, written in the approval's own
-- transaction. The payee's receiver, when one is on record, is fixed on the
-- execution now, and so is the wallet it names, so a later change of either
-- cannot move money the family already approved.
CREATE OR REPLACE FUNCTION kin_private.queue_payout() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_execution uuid := gen_random_uuid();
    v_payee public.payees;
  BEGIN
    SELECT * INTO v_payee FROM public.payees
      WHERE circle_id = NEW.circle_id
        AND ((NEW.payee_id IS NOT NULL AND id = NEW.payee_id)
          OR (NEW.member_id IS NOT NULL AND member_id = NEW.member_id AND category = 'settlement'));
    INSERT INTO public.executions (id, circle_id, proposal_id, idempotency_key, state, receiver, wallet)
      VALUES (v_execution, NEW.circle_id, NEW.id, 'kin-payout-' || NEW.id::text, 'created', v_payee.paypal_receiver, coalesce(v_payee.payout_wallet, 'paypal'));
    INSERT INTO public.outbox (id, circle_id, topic, payload)
      VALUES (gen_random_uuid(), NEW.circle_id, 'payout.execute', jsonb_build_object('executionId', v_execution));
    IF NEW.settlement_id IS NOT NULL THEN
      UPDATE public.settlements SET state = 'approved' WHERE circle_id = NEW.circle_id AND id = NEW.settlement_id AND state = 'proposed';
    END IF;
    RETURN NEW;
  END
  $$;

-- Which wallet an execution pays into is fixed when it is made.
CREATE FUNCTION kin_private.assert_wallet_fixed() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.wallet IS DISTINCT FROM OLD.wallet THEN
      RAISE EXCEPTION 'kin: execution % already pays into %, and cannot be pointed elsewhere', OLD.id, OLD.wallet
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER wallet_fixed BEFORE UPDATE OF wallet ON public.executions
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_wallet_fixed();
--> statement-breakpoint

-- Where a caregiver's pay goes and into which wallet: the caregiver, and
-- nobody else, as set_own_receiver (0010) decides it. A PayPal wallet takes an
-- email. A Venmo wallet takes an email, a phone number or an @handle. The target
-- cannot change while a payment to the caregiver waits for approval, is
-- approved, is being paid or failed and may be tried again, so the family approves
-- the destination it saw. A first target, while payments only wait for approval,
-- is always welcome because it redirects nothing; but once a payment is approved its
-- execution has pinned a wallet, so the wallet cannot change until it is finished.
CREATE FUNCTION kin_private.set_own_payout_target(p_circle uuid, p_receiver text, p_wallet text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_wallet text := lower(trim(coalesce(p_wallet, '')));
    v_receiver text := trim(coalesce(p_receiver, ''));
    v_member uuid;
    v_payee public.payees;
  BEGIN
    IF kin_private.my_role(p_circle) IS DISTINCT FROM 'caregiver' THEN
      RAISE EXCEPTION 'kin: caregiver payout target refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_member := kin_private.my_member_id(p_circle);
    SELECT * INTO v_payee FROM public.payees
      WHERE circle_id = p_circle AND member_id = v_member AND caregiver_rate_cents_per_hour IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: no caregiver rate' USING ERRCODE = 'KB001';
    END IF;
    IF v_wallet NOT IN ('paypal', 'venmo') OR length(v_receiver) > 127 THEN
      RAISE EXCEPTION 'kin: invalid payout target' USING ERRCODE = 'check_violation';
    END IF;
    IF lower(v_receiver) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
      v_receiver := lower(v_receiver);
    ELSIF v_wallet <> 'venmo' OR (v_receiver !~ '^(\+?1)?[0-9]{10}$' AND v_receiver !~ '^@[A-Za-z0-9_-]{3,30}$') THEN
      RAISE EXCEPTION 'kin: invalid payout target' USING ERRCODE = 'check_violation';
    END IF;
    IF v_payee.paypal_receiver IS NOT DISTINCT FROM v_receiver AND v_payee.payout_wallet = v_wallet THEN
      RETURN;
    END IF;
    IF (v_payee.paypal_receiver IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.proposals
         WHERE circle_id = p_circle AND payee_id = v_payee.id
           AND state IN ('proposed', 'pending_approval', 'approved', 'executing', 'failed')))
       OR (v_payee.payout_wallet <> v_wallet AND EXISTS (
         SELECT 1 FROM public.proposals
         WHERE circle_id = p_circle AND payee_id = v_payee.id
           AND state IN ('approved', 'executing', 'failed'))) THEN
      RAISE EXCEPTION 'kin: a payment to this caregiver is in progress' USING ERRCODE = 'KB009';
    END IF;
    UPDATE public.payees SET paypal_receiver = v_receiver, payout_wallet = v_wallet WHERE id = v_payee.id AND circle_id = p_circle;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_member, 'caregiver_receiver.set', 'payee', v_payee.id,
              jsonb_build_object('replaced', v_payee.paypal_receiver IS NOT NULL, 'wallet', v_wallet), 'web');
  END
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.assert_shift_keys_fixed() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.assert_wallet_fixed() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.schedule_shift(uuid, uuid, text, uuid, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.check_in_shift(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.check_out_shift(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.confirm_shift(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.cancel_shift(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.set_shift_rules(uuid, uuid, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.grant_shift_permission(uuid, uuid, uuid, integer, bigint, date, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.set_shift_permission_status(uuid, uuid, public.mandate_status) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.pay_shift(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.shift_payment_facts(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.set_own_payout_target(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.schedule_shift(uuid, uuid, text, uuid, text, timestamptz, timestamptz) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.check_in_shift(uuid, uuid) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.check_out_shift(uuid, uuid) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.confirm_shift(uuid, uuid) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.cancel_shift(uuid, uuid) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.set_shift_rules(uuid, uuid, integer, integer, integer) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.grant_shift_permission(uuid, uuid, uuid, integer, bigint, date, date, text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.set_shift_permission_status(uuid, uuid, public.mandate_status) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.pay_shift(uuid, uuid, jsonb) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.shift_payment_facts(uuid, uuid) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.set_own_payout_target(uuid, text, text) TO kin_app;

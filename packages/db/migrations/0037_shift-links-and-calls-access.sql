-- No-login check-in links, Kin's phone call to the parent for the family's
-- word, and settling a shift with no person at the keyboard.
--
-- The tables shift_check_links, parent_call_settings and shift_calls, and the
-- shift's family_evidence_ref column, come from the generated migration before
-- this one. This file adds their access rules, and the operations that write
-- them.
--
-- A check-in link is a bearer token. The web app holds only kin_app, so the
-- token cannot be a service identity: it is 32 random bytes the web app makes
-- and shows once, and the database stores only its SHA-256. use_check_link,
-- open to kin_app with nobody signed in, finds the live link and then does
-- exactly what the signed-in caregiver's own check-in or check-out does, by
-- the same internal function, for the link's member and that shift only.
--
-- A call is a second way to turn the family's key. The telephony service, as
-- kin_service, starts a call, reports it and records the parent's spoken answer;
-- those operations are granted to kin_service alone and each checks both who
-- connected and the circle in scope, so no person and no other circle can reach
-- them. A word spoken on a call is evidence like any approval: it is audited with
-- the call's ID and stored on the shift, never the audio or the number.
--
-- Refusals that screens word, by SQLSTATE (the shift ones are listed in 0033):
--   KS010  the shift already has its five live check-in links
--   KC001  a call is switched on only with the parent's consent
--   KC002  no such call for this shift
--   KC003  the call is not in a state that allows this
-- A link or call that cannot be used for any reason is refused with 42501 and
-- one message, so a refusal never says whether a token exists.
ALTER TABLE public.shift_check_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_call_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_calls ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Like every circle table: the service acts for the circle it names, and the
-- provisioner fills the circle it is creating. No role of the web app reads the
-- links at all (no policy for kin_app): a token's hash is a credential, and a
-- screen needs only the operations. The parent's number never leaves the table through a policy:
-- the parent and the organizer read the settings but not the phone column, and
-- the service gets it only through start_shift_call. Everyone who sees the
-- circle's money sees how a call went, but not the provider's call ID.
CREATE POLICY service_own_circle ON public.shift_check_links FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY service_own_circle ON public.parent_call_settings FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY service_own_circle ON public.shift_calls FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY provisioner_new_circle ON public.shift_check_links FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
CREATE POLICY app_parent_read ON public.parent_call_settings FOR SELECT TO kin_app
  USING (kin_private.my_role(circle_id) IN ('parent', 'organizer'));
CREATE POLICY app_member_read ON public.shift_calls FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));
--> statement-breakpoint

GRANT SELECT (id, circle_id, member_id, enabled, locale, consented_by, consented_at, quiet_start, quiet_end, updated_at)
  ON public.parent_call_settings TO kin_app, kin_service;
GRANT SELECT (id, circle_id, shift_id, attempt, state, created_at, ended_at) ON public.shift_calls TO kin_app;
GRANT SELECT ON public.shift_calls TO kin_service;
-- A link's token hash is granted to nobody. The app's role is given the two
-- plain columns and no policy, as it is for the outbox, so a probe of the table
-- finds nothing; the service may read the rest, to see a link's use.
GRANT SELECT (id, circle_id) ON public.shift_check_links TO kin_app;
GRANT SELECT (id, circle_id, shift_id, member_id, expires_at, created_by, created_at, uses, last_used_at) ON public.shift_check_links TO kin_service;
GRANT INSERT ON public.shift_check_links TO kin_provisioner;
--> statement-breakpoint

-- A call moves along the diagram in packages/domain, checked against it by a
-- test. Once a call has an ID, a shift and an attempt, they never change.
INSERT INTO kin_private.state_transitions (machine, from_state, to_state) VALUES
  ('shift_call', 'queued', 'calling'),
  ('shift_call', 'queued', 'failed'),
  ('shift_call', 'calling', 'answered'),
  ('shift_call', 'calling', 'confirmed'),
  ('shift_call', 'calling', 'declined'),
  ('shift_call', 'calling', 'no_answer'),
  ('shift_call', 'calling', 'failed'),
  ('shift_call', 'answered', 'confirmed'),
  ('shift_call', 'answered', 'declined'),
  ('shift_call', 'answered', 'failed');

CREATE TRIGGER state_moves_forward BEFORE UPDATE OF state ON public.shift_calls
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_transition('shift_call');

CREATE FUNCTION kin_private.assert_shift_call_fixed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF (to_jsonb(NEW) - ARRAY['state', 'call_sid', 'last_error', 'ended_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state', 'call_sid', 'last_error', 'ended_at'])
       OR (OLD.call_sid IS NOT NULL AND NEW.call_sid IS DISTINCT FROM OLD.call_sid)
       OR (OLD.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM OLD.ended_at) THEN
      RAISE EXCEPTION 'kin: call % cannot change what it is', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER call_fixed BEFORE UPDATE ON public.shift_calls
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_shift_call_fixed();
--> statement-breakpoint

-- The family's word on a shift is fixed once given, with what proves it: 0035's
-- guard, with the evidence column held fixed with the word, and a word that
-- came with evidence turning only on the moves that may turn it, as before.
CREATE OR REPLACE FUNCTION kin_private.assert_shift_keys_fixed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF (to_jsonb(NEW) - ARRAY['state', 'checked_in_at', 'checked_out_at', 'family_confirmed_by', 'family_confirmed_at', 'family_confirmation', 'family_evidence_ref',
                              'worked_minutes', 'billable_minutes', 'rate_cents_per_hour', 'cents', 'proposal_id', 'permission_id'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state', 'checked_in_at', 'checked_out_at', 'family_confirmed_by', 'family_confirmed_at', 'family_confirmation', 'family_evidence_ref',
                                               'worked_minutes', 'billable_minutes', 'rate_cents_per_hour', 'cents', 'proposal_id', 'permission_id']) THEN
      RAISE EXCEPTION 'kin: shift % cannot change what it is after it is scheduled', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF (OLD.checked_in_at IS NOT NULL AND NEW.checked_in_at IS DISTINCT FROM OLD.checked_in_at)
       OR (OLD.checked_out_at IS NOT NULL AND NEW.checked_out_at IS DISTINCT FROM OLD.checked_out_at)
       OR (OLD.family_confirmed_at IS NOT NULL AND (NEW.family_confirmed_at IS DISTINCT FROM OLD.family_confirmed_at
           OR NEW.family_confirmed_by IS DISTINCT FROM OLD.family_confirmed_by OR NEW.family_confirmation IS DISTINCT FROM OLD.family_confirmation
           OR NEW.family_evidence_ref IS DISTINCT FROM OLD.family_evidence_ref))
       OR (OLD.proposal_id IS NOT NULL AND (NEW.proposal_id IS DISTINCT FROM OLD.proposal_id OR NEW.permission_id IS DISTINCT FROM OLD.permission_id
           OR NEW.cents IS DISTINCT FROM OLD.cents OR NEW.worked_minutes IS DISTINCT FROM OLD.worked_minutes
           OR NEW.billable_minutes IS DISTINCT FROM OLD.billable_minutes OR NEW.rate_cents_per_hour IS DISTINCT FROM OLD.rate_cents_per_hour)) THEN
      RAISE EXCEPTION 'kin: a key of shift % has turned and cannot change', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF (OLD.checked_in_at IS NULL AND NEW.checked_in_at IS NOT NULL AND NOT (OLD.state::text = 'scheduled' AND NEW.state::text = 'checked_in'))
       OR (OLD.checked_out_at IS NULL AND NEW.checked_out_at IS NOT NULL AND NOT (OLD.state::text = 'checked_in' AND NEW.state::text IN ('checked_out', 'confirmed')))
       OR (OLD.family_confirmed_at IS NULL AND NEW.family_confirmed_at IS NOT NULL
           AND NOT (OLD.state::text IN ('checked_in', 'checked_out') AND NEW.state::text IN (OLD.state::text, 'confirmed')))
       OR (OLD.proposal_id IS NULL AND NEW.proposal_id IS NOT NULL AND NOT (OLD.state::text = 'confirmed' AND NEW.state::text = 'priced')) THEN
      RAISE EXCEPTION 'kin: shift % cannot turn that key now', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.state::text = 'paid' AND OLD.state::text <> 'paid' AND NOT EXISTS (
      SELECT 1 FROM public.proposals p WHERE p.circle_id = NEW.circle_id AND p.id = NEW.proposal_id AND p.state = 'settled'
    ) THEN
      RAISE EXCEPTION 'kin: shift % is paid only once its payment settled', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    -- Any other way into credited is refused by the state machine's own trigger.
    IF NEW.state::text = 'credited' AND OLD.state::text = 'confirmed' THEN
      IF session_user <> 'kin_service' THEN
        RAISE EXCEPTION 'kin: only Kin''s service credits a visit' USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM public.care_entries c
        JOIN public.ledger_entries l ON l.circle_id = c.circle_id AND l.id = c.ledger_entry_id AND l.kind = 'care_credit'
        WHERE c.circle_id = NEW.circle_id AND c.shift_id = NEW.id AND c.approved
          AND c.member_id = NEW.member_id
          AND c.minutes = floor(extract(epoch FROM (NEW.checked_out_at - NEW.checked_in_at)) / 60)
      ) THEN
        RAISE EXCEPTION 'kin: visit % is credited only with the care entry that records it', OLD.id USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint
-- The caregiver's own key, as one implementation for the two ways to turn it:
-- the signed-in member (check_in_shift, check_out_shift) and a live check-in
-- link (use_check_link). Each takes the member id to act for and refuses any
-- other member's shift; neither is granted to any role, only the operations
-- below call them. What they do is exactly what 0033 did: the circle's clock,
-- the real-circle time window, the minimum visit, the shift's state rules and
-- the audit row, now with the origin that asked.
CREATE FUNCTION kin_private.apply_check_in(p_circle uuid, p_shift uuid, p_member uuid, p_origin text, p_extra jsonb) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_shift public.shifts;
    v_now timestamptz;
    v_demo boolean;
  BEGIN
    SELECT s.* INTO v_shift FROM public.shifts s JOIN public.circles c ON c.id = s.circle_id AND c.status = 'active'
      WHERE s.circle_id = p_circle AND s.id = p_shift FOR UPDATE OF s;
    IF NOT FOUND OR p_member IS NULL OR v_shift.member_id <> p_member THEN
      RAISE EXCEPTION 'kin: shift check-in refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_shift.checked_in_at IS NOT NULL THEN
      RETURN false;
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
      VALUES (gen_random_uuid(), p_circle, 'member', p_member, 'shift.checked_in', 'shift', p_shift, p_extra, p_origin);
    RETURN true;
  END
  $$;
--> statement-breakpoint

-- The end of the caregiver's key. When the family's word is already in, the
-- shift is confirmed in the same statement; otherwise it waits for the word,
-- and an aide's shift in a real circle whose parent has asked to be phoned
-- queues Kin's call (topic shift.call) in this same transaction. Only the turn
-- that actually closes the visit queues anything: repeating it does not.
-- Returns whether this call turned the key.
CREATE FUNCTION kin_private.apply_check_out(p_circle uuid, p_shift uuid, p_member uuid, p_origin text, p_extra jsonb) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_shift public.shifts;
    v_circle public.circles;
    v_out timestamptz;
  BEGIN
    SELECT s.* INTO v_shift FROM public.shifts s JOIN public.circles c ON c.id = s.circle_id AND c.status = 'active'
      WHERE s.circle_id = p_circle AND s.id = p_shift FOR UPDATE OF s;
    IF NOT FOUND OR p_member IS NULL OR v_shift.member_id <> p_member THEN
      RAISE EXCEPTION 'kin: shift check-out refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_shift.checked_out_at IS NOT NULL THEN
      RETURN false;
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
      VALUES (gen_random_uuid(), p_circle, 'member', p_member, 'shift.checked_out', 'shift', p_shift,
              jsonb_build_object('confirmed', v_shift.family_confirmed_at IS NOT NULL) || p_extra, p_origin);
    IF v_shift.family_confirmed_at IS NULL AND v_shift.kind = 'aide' AND NOT v_circle.demo AND EXISTS (
      SELECT 1 FROM public.parent_call_settings s WHERE s.circle_id = p_circle AND s.enabled AND s.consented_at IS NOT NULL
    ) THEN
      INSERT INTO public.outbox (id, circle_id, topic, payload)
        VALUES (gen_random_uuid(), p_circle, 'shift.call', jsonb_build_object('shiftId', p_shift));
    END IF;
    RETURN true;
  END
  $$;
--> statement-breakpoint

-- The signed-in caregiver's check-in and check-out, unchanged for them: only the
-- member the shift is for, on the circle's clock, never on a time they send.
CREATE OR REPLACE FUNCTION kin_private.check_in_shift(p_circle uuid, p_shift uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
  BEGIN
    IF v_me IS NULL THEN
      RAISE EXCEPTION 'kin: shift check-in refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM kin_private.apply_check_in(p_circle, p_shift, v_me, 'web', '{}'::jsonb);
  END
  $$;

CREATE OR REPLACE FUNCTION kin_private.check_out_shift(p_circle uuid, p_shift uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
  BEGIN
    IF v_me IS NULL THEN
      RAISE EXCEPTION 'kin: shift check-out refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM kin_private.apply_check_out(p_circle, p_shift, v_me, 'web', '{}'::jsonb);
  END
  $$;
--> statement-breakpoint
-- Settling a shift with no person. pay_shift and shift_payment_facts, as 0033
-- wrote them, with one addition: Kin's own service may call them for the circle
-- it is scoped to, so the worker can settle a shift whose last key turned with
-- nobody signed in (a check-out by link, the parent's word by phone). Nothing
-- is loosened for a person: an observer is still refused, a caregiver still
-- settles only their own shift, and every check stays where it was (the
-- confirmed state, the price worked out again in SQL, the ceiling, the pause,
-- the permission's limits and plan equality). The service's own record carries
-- no member: the audit row says actor 'service', origin 'worker'.
CREATE OR REPLACE FUNCTION kin_private.pay_shift(p_circle uuid, p_shift uuid, p_plan jsonb) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_me uuid := kin_private.my_member_id(p_circle);
    v_service boolean := session_user = 'kin_service';
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
    IF v_service THEN
      -- Kin's worker settles a shift whose two keys have turned when no person
      -- is there to: for the one circle in its scope, with no member behind it.
      IF p_circle IS DISTINCT FROM kin_private.circle_id() THEN
        RAISE EXCEPTION 'kin: paying a shift refused' USING ERRCODE = 'insufficient_privilege';
      END IF;
      v_role := NULL;
      v_me := NULL;
    ELSIF v_role IS NULL OR v_role = 'observer' OR v_me IS NULL THEN
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
      VALUES (gen_random_uuid(), p_circle, CASE WHEN v_service THEN 'service'::public.audit_actor ELSE 'member'::public.audit_actor END, v_me, 'shift.priced', 'shift', p_shift,
              jsonb_build_object('proposalId', v_proposal, 'cents', v_cents, 'minutes', v_billable, 'permissionId', CASE WHEN v_by_permission THEN v_perm.id END),
              CASE WHEN v_service THEN 'worker' ELSE 'web' END);
    RETURN v_proposal;
  END
  $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION kin_private.shift_payment_facts(p_circle uuid, p_shift uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_me uuid := kin_private.my_member_id(p_circle);
    v_service boolean := session_user = 'kin_service';
    v_circle public.circles;
    v_shift public.shifts;
    v_payee public.payees;
    v_agreement public.agreements;
    v_now timestamptz;
    v_day date;
  BEGIN
    IF v_service THEN
      IF p_circle IS DISTINCT FROM kin_private.circle_id() THEN
        RAISE EXCEPTION 'kin: reading a shift''s payment facts refused' USING ERRCODE = 'insufficient_privilege';
      END IF;
      v_role := NULL;
      v_me := NULL;
    ELSIF v_role IS NULL OR v_role = 'observer' OR v_me IS NULL THEN
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
-- Making a check-in link. The web app makes 32 random bytes and sends only
-- their SHA-256 (lowercase hex); it shows the token once and keeps nothing.
-- The shift's own member may make one for themselves, and an organizer, a
-- contributor or the parent for any shift; an observer, and a caregiver for
-- another's shift, are refused. A link expires between now and six hours after
-- the shift was planned to end, a shift has at most five live ones, and a
-- cancelled or finished shift gets none. Sending the same hash for the same
-- shift and expiry again returns the link already made.
CREATE FUNCTION kin_private.mint_check_link(p_circle uuid, p_shift uuid, p_token_hash text, p_expires_at timestamptz) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_me uuid := kin_private.my_member_id(p_circle);
    v_shift public.shifts;
    v_circle public.circles;
    v_existing public.shift_check_links;
    v_now timestamptz;
    v_id uuid := gen_random_uuid();
  BEGIN
    IF v_role IS NULL OR v_role = 'observer' OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: making a check-in link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    SELECT * INTO v_shift FROM public.shifts WHERE circle_id = p_circle AND id = p_shift FOR UPDATE;
    IF v_circle.id IS NULL OR v_shift.id IS NULL
       OR NOT (v_shift.member_id = v_me OR v_role IN ('organizer', 'contributor', 'parent')) THEN
      RAISE EXCEPTION 'kin: making a check-in link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' OR p_expires_at IS NULL THEN
      RAISE EXCEPTION 'kin: a check-in link needs a token hash and an expiry' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_existing FROM public.shift_check_links WHERE token_hash = p_token_hash;
    IF FOUND THEN
      IF v_existing.circle_id = p_circle AND v_existing.shift_id = p_shift AND v_existing.expires_at = p_expires_at THEN
        RETURN v_existing.id;
      END IF;
      RAISE EXCEPTION 'kin: check-in link key reused' USING ERRCODE = 'KB004';
    END IF;
    IF v_shift.state NOT IN ('scheduled', 'checked_in') THEN
      RAISE EXCEPTION 'kin: the shift is closed' USING ERRCODE = 'KS002';
    END IF;
    v_now := coalesce(v_circle.clock_at, now());
    IF p_expires_at <= v_now OR p_expires_at > v_shift.ends_at + interval '6 hours' THEN
      RAISE EXCEPTION 'kin: a check-in link must expire between now and six hours after the shift' USING ERRCODE = 'check_violation';
    END IF;
    IF (SELECT count(*) FROM public.shift_check_links WHERE circle_id = p_circle AND shift_id = p_shift AND expires_at > v_now) >= 5 THEN
      RAISE EXCEPTION 'kin: the shift has all the check-in links it may' USING ERRCODE = 'KS010';
    END IF;
    -- Created at the circle's own moment, so a demo circle's standing clock still sees it expire after it began.
    INSERT INTO public.shift_check_links (id, circle_id, shift_id, member_id, token_hash, expires_at, created_by, created_at)
      VALUES (v_id, p_circle, p_shift, v_shift.member_id, p_token_hash, p_expires_at, v_me, v_now);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'shift.link_minted', 'shift', p_shift,
              jsonb_build_object('linkId', v_id, 'expiresAt', p_expires_at), 'web');
    RETURN v_id;
  END
  $$;
--> statement-breakpoint

-- Using a check-in link: the one operation that needs nobody signed in. The
-- token is checked by its hash. The link acts only for its own member on its
-- own shift, and does what the signed-in caregiver's check-in or check-out
-- does (apply_check_in, apply_check_out), so the real-circle window, the
-- minimum visit, the state rules and the audit are one implementation. A
-- token that is malformed, unknown, expired, for a cancelled shift or used too
-- often is refused the same way with 42501, saying nothing of which. A use
-- counts toward six a minute for the link. When a check-out brings the
-- shift to confirmed there is no person to settle it, so the settling is
-- queued for the worker (topic shift.settle) in this same transaction.
CREATE FUNCTION kin_private.use_check_link(p_token text, p_action text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_hash text;
    v_link public.shift_check_links;
    v_shift public.shifts;
    v_circle public.circles;
    v_name text;
    v_now timestamptz;
    v_turned boolean;
    v_fresh_window boolean;
  BEGIN
    IF p_action IS NULL OR p_action NOT IN ('in', 'out') OR p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
      RAISE EXCEPTION 'kin: check-in link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
    SELECT * INTO v_link FROM public.shift_check_links WHERE token_hash = v_hash;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: check-in link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- The shift is locked before the link, here and in mint_check_link, so two uses and a mint cannot deadlock.
    SELECT * INTO v_shift FROM public.shifts WHERE circle_id = v_link.circle_id AND id = v_link.shift_id FOR UPDATE;
    SELECT * INTO v_circle FROM public.circles WHERE id = v_link.circle_id AND status = 'active';
    SELECT * INTO v_link FROM public.shift_check_links WHERE id = v_link.id FOR UPDATE;
    SELECT m.display_name INTO v_name FROM public.members m
      WHERE m.circle_id = v_link.circle_id AND m.id = v_link.member_id AND m.status = 'active';
    v_now := coalesce(v_circle.clock_at, now());
    IF v_shift.id IS NULL OR v_circle.id IS NULL OR v_name IS NULL OR v_shift.member_id <> v_link.member_id
       OR v_link.expires_at <= v_now OR v_shift.state = 'cancelled'
       OR (v_link.window_started_at IS NOT NULL AND v_link.window_started_at > now() - interval '1 minute' AND v_link.window_uses >= 6) THEN
      RAISE EXCEPTION 'kin: check-in link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_action = 'in' THEN
      v_turned := kin_private.apply_check_in(v_link.circle_id, v_link.shift_id, v_link.member_id, 'link', jsonb_build_object('via', 'link', 'linkId', v_link.id));
    ELSE
      v_turned := kin_private.apply_check_out(v_link.circle_id, v_link.shift_id, v_link.member_id, 'link', jsonb_build_object('via', 'link', 'linkId', v_link.id));
    END IF;

    v_fresh_window := v_link.window_started_at IS NULL OR v_link.window_started_at <= now() - interval '1 minute';
    UPDATE public.shift_check_links
      SET uses = uses + 1, last_used_at = v_now,
          window_started_at = CASE WHEN v_fresh_window THEN now() ELSE window_started_at END,
          window_uses = CASE WHEN v_fresh_window THEN 1 ELSE window_uses + 1 END
      WHERE id = v_link.id;

    SELECT * INTO v_shift FROM public.shifts WHERE circle_id = v_link.circle_id AND id = v_link.shift_id;
    IF v_turned AND p_action = 'out' AND v_shift.state = 'confirmed' AND v_shift.kind = 'aide' THEN
      INSERT INTO public.outbox (id, circle_id, topic, payload)
        VALUES (gen_random_uuid(), v_link.circle_id, 'shift.settle', jsonb_build_object('shiftId', v_shift.id));
    END IF;
    RETURN jsonb_build_object(
      'shiftId', v_shift.id, 'circleId', v_shift.circle_id, 'kind', v_shift.kind, 'state', v_shift.state,
      'startsAt', v_shift.starts_at, 'endsAt', v_shift.ends_at,
      'checkedInAt', v_shift.checked_in_at, 'checkedOutAt', v_shift.checked_out_at,
      'memberFirstName', split_part(btrim(v_name), ' ', 1),
      'timezone', v_circle.timezone,
      'familyWordIn', v_shift.family_confirmed_at IS NOT NULL,
      'action', p_action, 'turned', v_turned);
  END
  $$;
--> statement-breakpoint

-- Looking at a check-in link without using it: what the public page needs to
-- say, before any tap, whose visit this is, when it is planned (in the circle's
-- own time zone) and which one key fits where the visit is. It finds the link
-- and applies every test use_check_link applies (a 43-character token, its hash,
-- a live link, an active circle and member, the link's own member on the shift,
-- not expired on the circle's clock, shift not cancelled) and refuses a dead
-- token with the same 42501 and the same message, after the same lookups, so a
-- refusal says nothing of which test failed. It changes nothing: no counter, no
-- last_used_at, no audit row, no lock (so it is STABLE). It returns no ID of the
-- shift or the circle and nothing about money, only the first name, the times, the
-- kind, the state, the time zone, whether the family's word is in, and `next`:
-- 'in' before the check-in, 'out' between the two, 'done' after both, from the
-- shift's own two times and never from anything the caller sends.
--
-- It is an unauthenticated oracle, so what stops guessing is reasoned here. A
-- link is 256 random bits and the shape is checked first, so one guess in
-- 2^256 lands, however many are made. A counter that survives a refusal cannot
-- be kept cleanly: a raised exception rolls back its own writes, a dead token
-- has no link row to count against, and a table or a global counter keyed on
-- failures would give anyone a way to lock every caregiver out, a worse hole
-- than the one it closes. So the read is not counted here; the web app
-- throttles it per address, as it does the tap, and use_check_link keeps the
-- six-a-minute cap for the only operation that writes.
CREATE FUNCTION kin_private.check_link_status(p_token text) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_hash text;
    v_link public.shift_check_links;
    v_shift public.shifts;
    v_circle public.circles;
    v_name text;
  BEGIN
    IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
      RAISE EXCEPTION 'kin: check-in link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
    SELECT * INTO v_link FROM public.shift_check_links WHERE token_hash = v_hash;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: check-in link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_shift FROM public.shifts WHERE circle_id = v_link.circle_id AND id = v_link.shift_id;
    SELECT * INTO v_circle FROM public.circles WHERE id = v_link.circle_id AND status = 'active';
    SELECT m.display_name INTO v_name FROM public.members m
      WHERE m.circle_id = v_link.circle_id AND m.id = v_link.member_id AND m.status = 'active';
    IF v_shift.id IS NULL OR v_circle.id IS NULL OR v_name IS NULL OR v_shift.member_id <> v_link.member_id
       OR v_link.expires_at <= coalesce(v_circle.clock_at, now()) OR v_shift.state = 'cancelled' THEN
      RAISE EXCEPTION 'kin: check-in link refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN jsonb_build_object(
      'kind', v_shift.kind, 'state', v_shift.state,
      'startsAt', v_shift.starts_at, 'endsAt', v_shift.ends_at,
      'memberFirstName', split_part(btrim(v_name), ' ', 1),
      'timezone', v_circle.timezone,
      'familyWordIn', v_shift.family_confirmed_at IS NOT NULL,
      'next', CASE WHEN v_shift.checked_in_at IS NULL THEN 'in' WHEN v_shift.checked_out_at IS NULL THEN 'out' ELSE 'done' END);
  END
  $$;
--> statement-breakpoint
-- The wait before Kin's second attempt at a call, in one place.
CREATE FUNCTION kin_private.call_retry_delay() RETURNS interval
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT interval '30 minutes' $$;
--> statement-breakpoint

-- Whether Kin may phone the parent, and where. The parent switches it on, in a
-- real circle, and only with consent, which is recorded with who gave it and
-- when each time a call is switched on or its number changes. In a demo circle
-- the organizer plays the parent, and a demo circle never places a real call.
-- Switching it off is always allowed to the organizers, contributors and
-- parent, since stopping is safe. The audit rows never hold the number. The
-- language she is spoken to in is her own account's, or English.
CREATE FUNCTION kin_private.set_parent_call_settings(p_circle uuid, p_phone text, p_enabled boolean, p_consent boolean) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_parent uuid;
    v_existing public.parent_call_settings;
    v_had boolean;
    v_locale text;
    v_now timestamptz;
  BEGIN
    IF v_role IS NULL OR v_me IS NULL OR v_role NOT IN ('organizer', 'contributor', 'parent') OR p_enabled IS NULL THEN
      RAISE EXCEPTION 'kin: parent call settings refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    IF v_circle.id IS NULL THEN
      RAISE EXCEPTION 'kin: parent call settings refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_now := coalesce(v_circle.clock_at, now());
    SELECT * INTO v_existing FROM public.parent_call_settings WHERE circle_id = p_circle FOR UPDATE;
    v_had := FOUND;

    IF NOT p_enabled THEN
      IF v_had AND v_existing.enabled THEN
        UPDATE public.parent_call_settings SET enabled = false, updated_at = v_now WHERE circle_id = p_circle;
        INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
          VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'parent_call.disabled', 'parent_call_settings', v_existing.id, '{}'::jsonb, 'web');
      END IF;
      RETURN;
    END IF;

    IF v_role = 'parent' THEN
      v_parent := v_me;
    ELSIF v_role = 'organizer' AND v_circle.demo THEN
      v_parent := (SELECT m.id FROM public.members m WHERE m.circle_id = p_circle AND m.role = 'parent' AND m.status = 'active' ORDER BY m.joined_at, m.id LIMIT 1);
    ELSE
      RAISE EXCEPTION 'kin: only the parent switches on a call to herself' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_parent IS NULL THEN
      RAISE EXCEPTION 'kin: the circle has no parent to call' USING ERRCODE = 'KM002';
    END IF;
    IF p_consent IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'kin: a call is switched on only with consent' USING ERRCODE = 'KC001';
    END IF;
    IF p_phone IS NULL OR p_phone !~ '^\+[1-9][0-9]{6,14}$' THEN
      RAISE EXCEPTION 'kin: the number is not a phone number' USING ERRCODE = 'check_violation';
    END IF;
    IF v_had AND v_existing.enabled AND v_existing.phone = p_phone AND v_existing.member_id = v_parent THEN
      RETURN;
    END IF;

    SELECT CASE WHEN u.language ~ '^[a-z]{2}' THEN substr(u.language, 1, 2) ELSE 'en' END INTO v_locale
      FROM public.members m LEFT JOIN public.users u ON u.id = m.user_id WHERE m.circle_id = p_circle AND m.id = v_parent;
    INSERT INTO public.parent_call_settings (id, circle_id, member_id, phone, enabled, locale, consented_by, consented_at, updated_at)
      VALUES (gen_random_uuid(), p_circle, v_parent, p_phone, true, coalesce(v_locale, 'en'), v_me, v_now, v_now)
      ON CONFLICT (circle_id) DO UPDATE
        SET member_id = EXCLUDED.member_id, phone = EXCLUDED.phone, enabled = true, locale = EXCLUDED.locale,
            consented_by = EXCLUDED.consented_by, consented_at = EXCLUDED.consented_at, updated_at = EXCLUDED.updated_at;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'parent_call.enabled', 'parent_call_settings',
              coalesce(v_existing.id, (SELECT s.id FROM public.parent_call_settings s WHERE s.circle_id = p_circle)),
              jsonb_build_object('simulated', v_circle.demo, 'numberChanged', v_had AND v_existing.phone IS DISTINCT FROM p_phone), 'web');
  END
  $$;
--> statement-breakpoint

-- Starting Kin's call to the parent, for the worker that leased a shift.call
-- message. Kin's service only, and only for the circle in its scope. The shift
-- must still wait for the family's word, in a real circle, with the parent's
-- consent on record, her number set by the circle's active parent, outside the
-- quiet hours on the circle's own clock, with no call under way, no earlier no
-- from her, fewer than two attempts and the second not before the wait is over.
-- Anything that is not so is not an error: the answer says why, and when to
-- try again if waiting would help, so the worker can finish or delay its
-- message. Otherwise it records the attempt as queued and returns only what
-- is needed to dial: the number, the language and the inputs for greeting her.
CREATE FUNCTION kin_private.start_shift_call(p_circle uuid, p_shift uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_circle public.circles;
    v_shift public.shifts;
    v_settings public.parent_call_settings;
    v_parent_name text;
    v_caregiver_name text;
    v_now timestamptz;
    v_local time;
    v_quiet boolean;
    v_retry timestamptz;
    v_last public.shift_calls;
    v_attempts integer;
    v_call uuid := gen_random_uuid();
  BEGIN
    IF session_user <> 'kin_service' OR p_circle IS DISTINCT FROM kin_private.circle_id() THEN
      RAISE EXCEPTION 'kin: starting a call refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    SELECT * INTO v_shift FROM public.shifts WHERE circle_id = p_circle AND id = p_shift FOR UPDATE;
    IF v_circle.id IS NULL OR v_shift.id IS NULL THEN
      RAISE EXCEPTION 'kin: starting a call refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_now := coalesce(v_circle.clock_at, now());

    IF v_circle.demo THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'demo_circle');
    END IF;
    IF v_shift.kind <> 'aide' OR v_shift.state <> 'checked_out' OR v_shift.family_confirmed_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_waiting');
    END IF;
    IF v_shift.checked_out_at < v_now - interval '24 hours' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'expired');
    END IF;
    SELECT * INTO v_settings FROM public.parent_call_settings WHERE circle_id = p_circle;
    IF NOT FOUND OR NOT v_settings.enabled OR v_settings.consented_at IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_enabled');
    END IF;
    SELECT m.display_name INTO v_parent_name FROM public.members m
      WHERE m.circle_id = p_circle AND m.id = v_settings.member_id AND m.role = 'parent' AND m.status = 'active';
    IF v_parent_name IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'no_parent');
    END IF;
    IF EXISTS (SELECT 1 FROM public.shift_calls WHERE circle_id = p_circle AND shift_id = p_shift AND state = 'declined') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'declined');
    END IF;
    IF EXISTS (SELECT 1 FROM public.shift_calls WHERE circle_id = p_circle AND shift_id = p_shift AND state IN ('queued', 'calling', 'answered')) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'in_progress');
    END IF;
    SELECT count(*) INTO v_attempts FROM public.shift_calls WHERE circle_id = p_circle AND shift_id = p_shift;
    IF v_attempts >= 2 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'attempts_exhausted');
    END IF;
    SELECT * INTO v_last FROM public.shift_calls WHERE circle_id = p_circle AND shift_id = p_shift ORDER BY attempt DESC LIMIT 1;
    IF FOUND AND v_last.ended_at + kin_private.call_retry_delay() > v_now THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'too_soon', 'retryAt', v_last.ended_at + kin_private.call_retry_delay());
    END IF;

    v_local := (v_now AT TIME ZONE v_circle.timezone)::time;
    v_quiet := CASE WHEN v_settings.quiet_start < v_settings.quiet_end
      THEN v_local >= v_settings.quiet_start AND v_local < v_settings.quiet_end
      ELSE v_local >= v_settings.quiet_start OR v_local < v_settings.quiet_end END;
    IF v_quiet THEN
      v_retry := ((v_now AT TIME ZONE v_circle.timezone)::date + v_settings.quiet_end) AT TIME ZONE v_circle.timezone;
      IF v_retry <= v_now THEN
        v_retry := ((v_now AT TIME ZONE v_circle.timezone)::date + 1 + v_settings.quiet_end) AT TIME ZONE v_circle.timezone;
      END IF;
      RETURN jsonb_build_object('ok', false, 'reason', 'quiet_hours', 'retryAt', v_retry);
    END IF;

    SELECT m.display_name INTO v_caregiver_name FROM public.members m WHERE m.circle_id = p_circle AND m.id = v_shift.member_id;
    INSERT INTO public.shift_calls (id, circle_id, shift_id, attempt, state, created_at) VALUES (v_call, p_circle, p_shift, v_attempts + 1, 'queued', v_now);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'service', NULL, 'shift.call_started', 'shift', p_shift,
              jsonb_build_object('callId', v_call, 'attempt', v_attempts + 1), 'worker');
    RETURN jsonb_build_object(
      'ok', true, 'callId', v_call, 'attempt', v_attempts + 1,
      'phone', v_settings.phone, 'locale', v_settings.locale,
      'parentMemberId', v_settings.member_id, 'parentFirstName', split_part(btrim(v_parent_name), ' ', 1),
      'caregiverFirstName', split_part(btrim(v_caregiver_name), ' ', 1),
      'shiftId', v_shift.id, 'timezone', v_circle.timezone,
      'startsAt', v_shift.starts_at, 'endsAt', v_shift.ends_at,
      'checkedInAt', v_shift.checked_in_at, 'checkedOutAt', v_shift.checked_out_at);
  END
  $$;
--> statement-breakpoint

-- The telephony provider took the call: it now has an ID, which is what a word
-- spoken on it will be recorded against. Saying it again with the same ID
-- changes nothing.
CREATE FUNCTION kin_private.record_call_placed(p_circle uuid, p_shift uuid, p_call uuid, p_call_sid text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_call public.shift_calls;
  BEGIN
    IF session_user <> 'kin_service' OR p_circle IS DISTINCT FROM kin_private.circle_id() THEN
      RAISE EXCEPTION 'kin: recording a call refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_call_sid IS NULL OR p_call_sid !~ '^[A-Za-z0-9]{1,64}$' THEN
      RAISE EXCEPTION 'kin: the call ID is not valid' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_call FROM public.shift_calls WHERE circle_id = p_circle AND shift_id = p_shift AND id = p_call FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: no such call' USING ERRCODE = 'KC002';
    END IF;
    IF v_call.state = 'calling' AND v_call.call_sid = p_call_sid THEN
      RETURN;
    END IF;
    IF v_call.state <> 'queued' THEN
      RAISE EXCEPTION 'kin: the call is not waiting to be placed' USING ERRCODE = 'KC003';
    END IF;
    UPDATE public.shift_calls SET state = 'calling', call_sid = p_call_sid WHERE circle_id = p_circle AND id = p_call;
  END
  $$;
--> statement-breakpoint

-- How a call went, as the provider reports it: answered, not answered, or
-- failed (an unreachable number, a refusal, a drop before a word). The call
-- is found by its ID, or, with none, as the shift's call that was never placed.
-- A call that is already over stays as it is, so a late or repeated report is
-- harmless. When a first attempt ends without a word and the shift still waits
-- for it, a second attempt is queued for after the wait (topic shift.call).
-- Returns the call's state and when the second attempt may start.
CREATE FUNCTION kin_private.record_call_status(p_circle uuid, p_shift uuid, p_call_sid text, p_status text, p_error text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_call public.shift_calls;
    v_shift public.shifts;
    v_circle public.circles;
    v_now timestamptz;
    v_retry timestamptz;
    v_error text := nullif(left(btrim(coalesce(p_error, '')), 200), '');
  BEGIN
    IF session_user <> 'kin_service' OR p_circle IS DISTINCT FROM kin_private.circle_id() THEN
      RAISE EXCEPTION 'kin: recording a call refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_status IS NULL OR p_status NOT IN ('answered', 'no_answer', 'failed')
       OR (p_call_sid IS NOT NULL AND p_call_sid !~ '^[A-Za-z0-9]{1,64}$') THEN
      RAISE EXCEPTION 'kin: the call report is not valid' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    SELECT * INTO v_shift FROM public.shifts WHERE circle_id = p_circle AND id = p_shift FOR UPDATE;
    IF v_circle.id IS NULL OR v_shift.id IS NULL THEN
      RAISE EXCEPTION 'kin: recording a call refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_call_sid IS NOT NULL THEN
      SELECT * INTO v_call FROM public.shift_calls WHERE circle_id = p_circle AND shift_id = p_shift AND call_sid = p_call_sid FOR UPDATE;
    ELSE
      SELECT * INTO v_call FROM public.shift_calls WHERE circle_id = p_circle AND shift_id = p_shift AND state = 'queued' FOR UPDATE;
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: no such call' USING ERRCODE = 'KC002';
    END IF;
    v_now := coalesce(v_circle.clock_at, now());
    IF v_call.state IN ('confirmed', 'declined', 'no_answer', 'failed') OR v_call.state = p_status THEN
      RETURN jsonb_build_object('state', v_call.state, 'retryAt', NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM kin_private.state_transitions WHERE machine = 'shift_call' AND from_state = v_call.state AND to_state = p_status) THEN
      RAISE EXCEPTION 'kin: the call cannot move from % to %', v_call.state, p_status USING ERRCODE = 'KC003';
    END IF;
    UPDATE public.shift_calls
      SET state = p_status, last_error = CASE WHEN p_status = 'answered' THEN last_error ELSE v_error END,
          ended_at = CASE WHEN p_status = 'answered' THEN NULL ELSE v_now END
      WHERE circle_id = p_circle AND id = v_call.id;
    IF p_status <> 'answered' AND v_call.attempt < 2 AND NOT v_circle.demo AND v_shift.kind = 'aide' AND v_shift.state = 'checked_out'
       AND v_shift.family_confirmed_at IS NULL
       AND EXISTS (SELECT 1 FROM public.parent_call_settings s WHERE s.circle_id = p_circle AND s.enabled AND s.consented_at IS NOT NULL) THEN
      v_retry := v_now + kin_private.call_retry_delay();
      INSERT INTO public.outbox (id, circle_id, topic, payload, available_at)
        VALUES (gen_random_uuid(), p_circle, 'shift.call', jsonb_build_object('shiftId', p_shift), now() + kin_private.call_retry_delay());
    END IF;
    RETURN jsonb_build_object('state', p_status, 'retryAt', v_retry);
  END
  $$;
--> statement-breakpoint

-- The parent's spoken answer, from the call flow, as the family's second key.
-- A clear yes is her word: the shift's family_confirmed_by is the parent in
-- the call settings (who must still be the circle's active parent, with the
-- call switched on and consented to), the confirmation is a parent's, and the
-- evidence is the call's ID, which must be a call Kin placed for this shift. The
-- word still never changes once set, and turns only while the visit is under
-- way or just over. If the caregiver's key has turned the shift is confirmed in
-- the same statement and its settling is queued for the worker (topic
-- shift.settle). A no records a declined call and nothing else: nobody is paid
-- on it. An unclear answer records nothing, and the call flow asks again.
-- Saying a recorded answer again changes nothing. Audited as the service, with
-- the call's ID and never the audio or the number.
CREATE FUNCTION kin_private.record_family_word_by_call(p_circle uuid, p_shift uuid, p_call_sid text, p_answer text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_circle public.circles;
    v_shift public.shifts;
    v_call public.shift_calls;
    v_settings public.parent_call_settings;
    v_now timestamptz;
    v_state public.shift_state;
  BEGIN
    IF session_user <> 'kin_service' OR p_circle IS DISTINCT FROM kin_private.circle_id() THEN
      RAISE EXCEPTION 'kin: recording a word refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_answer IS NULL OR p_answer NOT IN ('yes', 'no', 'unclear') OR p_call_sid IS NULL OR p_call_sid !~ '^[A-Za-z0-9]{1,64}$' THEN
      RAISE EXCEPTION 'kin: the answer is not valid' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    SELECT * INTO v_shift FROM public.shifts WHERE circle_id = p_circle AND id = p_shift FOR UPDATE;
    IF v_circle.id IS NULL OR v_shift.id IS NULL OR v_circle.demo THEN
      RAISE EXCEPTION 'kin: recording a word refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_call FROM public.shift_calls WHERE circle_id = p_circle AND shift_id = p_shift AND call_sid = p_call_sid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: no such call' USING ERRCODE = 'KC002';
    END IF;
    v_now := date_trunc('second', coalesce(v_circle.clock_at, now()));

    IF p_answer = 'unclear' THEN
      RETURN jsonb_build_object('outcome', 'unclear', 'recorded', false, 'shiftState', v_shift.state);
    END IF;
    -- An answer already recorded, said again.
    IF (v_call.state = 'confirmed' AND p_answer = 'yes') OR (v_call.state = 'declined' AND p_answer = 'no') THEN
      RETURN jsonb_build_object('outcome', CASE WHEN p_answer = 'yes' THEN 'confirmed' ELSE 'declined' END, 'recorded', false, 'shiftState', v_shift.state);
    END IF;
    IF v_call.state NOT IN ('calling', 'answered') THEN
      RAISE EXCEPTION 'kin: the call is over' USING ERRCODE = 'KC003';
    END IF;

    IF p_answer = 'no' THEN
      UPDATE public.shift_calls SET state = 'declined', ended_at = v_now WHERE circle_id = p_circle AND id = v_call.id;
      INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
        VALUES (gen_random_uuid(), p_circle, 'service', NULL, 'shift.word_declined_by_call', 'shift', p_shift,
                jsonb_build_object('callId', v_call.id, 'callSid', p_call_sid), 'phone');
      RETURN jsonb_build_object('outcome', 'declined', 'recorded', true, 'shiftState', v_shift.state);
    END IF;

    -- A yes is the parent's word, if the parent is still who the call was set up for.
    SELECT * INTO v_settings FROM public.parent_call_settings WHERE circle_id = p_circle;
    IF NOT FOUND OR NOT v_settings.enabled OR v_settings.consented_at IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.members m WHERE m.circle_id = p_circle AND m.id = v_settings.member_id AND m.role = 'parent' AND m.status = 'active'
    ) THEN
      RAISE EXCEPTION 'kin: recording a word refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_shift.family_confirmed_at IS NOT NULL THEN
      -- Someone's word is already in and never changes; her yes is still what she said.
      UPDATE public.shift_calls SET state = 'confirmed', ended_at = v_now WHERE circle_id = p_circle AND id = v_call.id;
      RETURN jsonb_build_object('outcome', 'already_in', 'recorded', false, 'shiftState', v_shift.state);
    END IF;
    IF v_shift.state = 'cancelled' THEN
      RAISE EXCEPTION 'kin: the shift is closed' USING ERRCODE = 'KS002';
    END IF;
    IF v_shift.kind <> 'aide' OR v_shift.state NOT IN ('checked_in', 'checked_out') THEN
      RAISE EXCEPTION 'kin: the shift is not waiting for her word' USING ERRCODE = 'KS007';
    END IF;
    v_state := CASE WHEN v_shift.checked_out_at IS NOT NULL THEN 'confirmed'::public.shift_state ELSE v_shift.state END;
    UPDATE public.shifts
      SET family_confirmed_by = v_settings.member_id, family_confirmed_at = v_now, family_confirmation = 'parent',
          family_evidence_ref = p_call_sid, state = v_state
      WHERE circle_id = p_circle AND id = p_shift;
    UPDATE public.shift_calls SET state = 'confirmed', ended_at = v_now WHERE circle_id = p_circle AND id = v_call.id;
    IF v_state = 'confirmed' THEN
      INSERT INTO public.outbox (id, circle_id, topic, payload)
        VALUES (gen_random_uuid(), p_circle, 'shift.settle', jsonb_build_object('shiftId', p_shift));
    END IF;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'service', NULL, 'shift.word_by_call', 'shift', p_shift,
              jsonb_build_object('callId', v_call.id, 'callSid', p_call_sid, 'parentMemberId', v_settings.member_id), 'phone');
    RETURN jsonb_build_object('outcome', 'confirmed', 'recorded', true, 'shiftState', v_state);
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION kin_private.assert_shift_call_fixed() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.apply_check_in(uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.apply_check_out(uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.call_retry_delay() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.mint_check_link(uuid, uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.use_check_link(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.check_link_status(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.set_parent_call_settings(uuid, text, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.start_shift_call(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.record_call_placed(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.record_call_status(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.record_family_word_by_call(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.mint_check_link(uuid, uuid, text, timestamptz) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.use_check_link(text, text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.check_link_status(text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.set_parent_call_settings(uuid, text, boolean, boolean) TO kin_app;
-- Kin's worker settles a shift with no person (the checks inside refuse any circle but the one in scope).
GRANT EXECUTE ON FUNCTION kin_private.pay_shift(uuid, uuid, jsonb) TO kin_service;
GRANT EXECUTE ON FUNCTION kin_private.shift_payment_facts(uuid, uuid) TO kin_service;
-- Kin's service alone, never a person: each of these also checks who connected and the circle in scope.
GRANT EXECUTE ON FUNCTION kin_private.start_shift_call(uuid, uuid) TO kin_service;
GRANT EXECUTE ON FUNCTION kin_private.record_call_placed(uuid, uuid, uuid, text) TO kin_service;
GRANT EXECUTE ON FUNCTION kin_private.record_call_status(uuid, uuid, text, text, text) TO kin_service;
GRANT EXECUTE ON FUNCTION kin_private.record_family_word_by_call(uuid, uuid, text, text) TO kin_service;

-- A sibling's confirmed visit or drive counts toward their fair share.
--
-- The generated migration before this one adds the 'credited' shift state and
-- links a care entry to the shift it came from. This file makes the move safe:
-- only Kin's worker moves a confirmed visit to credited, and only once it has
-- written the care entry that records the credit; and a visit that becomes
-- confirmed queues that work in the same transaction.
--
-- PostgreSQL cannot use an enum value in the transaction that adds it, and a
-- deploy runs every pending migration in one transaction, so the state is
-- compared as text throughout.

-- The new move of the shift state machine, checked against packages/domain by a test.
INSERT INTO kin_private.state_transitions (machine, from_state, to_state) VALUES
  ('shift', 'confirmed', 'credited');
--> statement-breakpoint

-- Which members share the cost of care, and so are credited for it: the same
-- two roles the agreement gives a share to.
CREATE FUNCTION kin_private.shift_is_credited_kind(p_kind text, p_role public.circle_role) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT p_kind IN ('visit', 'drive') AND p_role::text IN ('organizer', 'contributor') $$;
--> statement-breakpoint

-- The shift guard, as 0033 wrote it, with one more rule: a shift becomes
-- credited only when the service moves it, and only with a care entry that
-- belongs to the same member, covers exactly the minutes between the two taps
-- and is valued by a care-credit ledger entry.
CREATE OR REPLACE FUNCTION kin_private.assert_shift_keys_fixed() RETURNS trigger
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

-- A visit or drive by a member who shares the cost, once both keys have turned,
-- asks the worker to credit it: an outbox message written in the same
-- transaction as the confirmation, so a confirmed visit is never forgotten.
CREATE FUNCTION kin_private.queue_shift_credit() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role public.circle_role;
  BEGIN
    SELECT m.role INTO v_role FROM public.members m WHERE m.circle_id = NEW.circle_id AND m.id = NEW.member_id;
    IF kin_private.shift_is_credited_kind(NEW.kind, v_role) THEN
      INSERT INTO public.outbox (id, circle_id, topic, payload)
        VALUES (gen_random_uuid(), NEW.circle_id, 'shift.credit', jsonb_build_object('shiftId', NEW.id));
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER queue_credit AFTER UPDATE OF state ON public.shifts
  FOR EACH ROW WHEN (NEW.state::text = 'confirmed' AND OLD.state::text <> 'confirmed')
  EXECUTE FUNCTION kin_private.queue_shift_credit();
--> statement-breakpoint

-- A care entry that came from a shift: only the service writes one, while the
-- shift is confirmed, for the member who did the visit and for the minutes
-- between the taps. Once written it never changes, and it cannot be linked to
-- a shift afterwards, so a visit is credited once and for what it was.
CREATE FUNCTION kin_private.assert_shift_care_entry() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_shift public.shifts;
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      IF OLD.shift_id IS NOT NULL OR NEW.shift_id IS NOT NULL THEN
        RAISE EXCEPTION 'kin: a care entry from a shift cannot change' USING ERRCODE = 'restrict_violation';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.shift_id IS NULL THEN
      RETURN NEW;
    END IF;
    IF session_user <> 'kin_service' THEN
      RAISE EXCEPTION 'kin: only Kin''s service credits a visit' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_shift FROM public.shifts WHERE circle_id = NEW.circle_id AND id = NEW.shift_id;
    IF NOT FOUND OR v_shift.state::text <> 'confirmed' OR v_shift.kind NOT IN ('visit', 'drive')
       OR v_shift.member_id <> NEW.member_id
       OR NEW.minutes <> floor(extract(epoch FROM (v_shift.checked_out_at - v_shift.checked_in_at)) / 60) THEN
      RAISE EXCEPTION 'kin: care entry does not match its confirmed visit' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER from_shift_fixed BEFORE INSERT OR UPDATE ON public.care_entries
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_shift_care_entry();
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.queue_shift_credit() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.assert_shift_care_entry() FROM PUBLIC;

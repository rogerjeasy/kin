-- The parent's wishes: who may read and write them, the rules the database
-- holds to, and the operations that write. Tables wishes, wish_signatures,
-- wish_recordings, wish_triggers, wish_attestations and parent_subscriptions,
-- and their checks, come from the generated migration before this one.
--
-- Plain code in packages/domain decides what a wish says and what it does
-- (wishes.ts, wish-trigger.ts). The database holds the same rules a second
-- time and keeps the record: only the parent writes her wishes, in her own
-- seat; a version's words and rule never change, a change is a new version
-- whose digest covers the one before; two family members who share the cost
-- witness it; and while a trigger is reported or active nothing about her
-- wishes may change, because that is when she is most at risk.
--
-- A trigger is what people said: one reports it, a second confirms it (two
-- family members, or one and the caregiver for a hospital admission), and the
-- same again ends it. Nobody who stands to gain from it counts toward starting
-- it: the successor a wish names, or the caregiver a wish keeps paid. The
-- parent's own word that she is fine ends it at once. Activating one suspends the subscriptions her wishes
-- name (a demo circle's at once, simulated; a real one's through PayPal by the
-- worker) and seats the successor she named; ending it undoes both.
--
-- Refusals that screens word, by SQLSTATE:
--   42501  the person may not do this, or the record is not theirs to see
--   23514  the wish or the subscription is not one the record can hold
--   KW001  a trigger is open, so her wishes cannot change now
--   KW002  a change of this wish is already waiting
--   KW003  the wish is not in a state that allows this
--   KW004  the trigger is already active
--   KW005  a different event is reported already
--   KW006  nothing is active to end
--   KW007  too many recordings today
--   KW008  PayPal does not say that subscription is the parent's
--   KW009  that PayPal subscription is already known to Kin
ALTER TABLE public.wishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wish_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wish_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wish_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wish_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Like every circle table: the service acts for the circle it names, and the
-- provisioner fills the circle it is creating. The family reads her wishes and
-- what they hold; a caregiver, who may be paid under them, does not. Everyone
-- in the circle sees a trigger and who attested it, since a caregiver may attest one.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wishes', 'wish_signatures', 'wish_recordings', 'wish_triggers', 'wish_attestations', 'parent_subscriptions'] LOOP
    EXECUTE format('CREATE POLICY service_own_circle ON public.%I FOR ALL TO kin_service USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id())', t);
    EXECUTE format('CREATE POLICY provisioner_new_circle ON public.%I FOR INSERT TO kin_provisioner WITH CHECK (kin_private.is_provisioning(circle_id))', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['wishes', 'wish_signatures', 'wish_recordings', 'parent_subscriptions'] LOOP
    EXECUTE format('CREATE POLICY app_member_read ON public.%I FOR SELECT TO kin_app USING (kin_private.sees_circle_money(circle_id))', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['wish_triggers', 'wish_attestations'] LOOP
    EXECUTE format('CREATE POLICY app_member_read ON public.%I FOR SELECT TO kin_app USING (kin_private.is_member(circle_id))', t);
  END LOOP;
END
$$;
--> statement-breakpoint

-- Only the operations below write. The worker reads them, and moves a real
-- subscription's state once PayPal's record says it moved.
GRANT SELECT ON public.wishes, public.wish_signatures, public.wish_recordings, public.wish_triggers, public.wish_attestations, public.parent_subscriptions TO kin_app, kin_service;
GRANT INSERT ON public.wishes, public.wish_signatures, public.wish_recordings, public.wish_triggers, public.wish_attestations, public.parent_subscriptions TO kin_provisioner;
GRANT UPDATE (state, held_by, changed_at) ON public.parent_subscriptions TO kin_service;
--> statement-breakpoint

-- Nothing here is ever deleted. Signatures, attestations and recordings are never changed.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wishes', 'wish_triggers', 'parent_subscriptions'] LOOP
    EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION kin_private.refuse_change()', t);
    EXECUTE format('CREATE TRIGGER no_delete_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION kin_private.refuse_change()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['wish_signatures', 'wish_recordings', 'wish_attestations'] LOOP
    EXECUTE format('CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION kin_private.refuse_change()', t);
    EXECUTE format('CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION kin_private.refuse_change()', t);
  END LOOP;
END
$$;
--> statement-breakpoint

-- The three state machines, held equal to packages/domain by a test.
INSERT INTO kin_private.state_transitions (machine, from_state, to_state) VALUES
  ('wish', 'draft', 'confirmed'),
  ('wish', 'draft', 'withdrawn'),
  ('wish', 'confirmed', 'in_force'),
  ('wish', 'confirmed', 'withdrawn'),
  ('wish', 'in_force', 'superseded'),
  ('wish', 'in_force', 'withdrawn'),
  ('wish_trigger', 'reported', 'active'),
  ('wish_trigger', 'reported', 'dismissed'),
  ('wish_trigger', 'active', 'ended'),
  ('parent_subscription', 'active', 'suspending'),
  ('parent_subscription', 'suspending', 'suspended'),
  ('parent_subscription', 'suspending', 'active'),
  ('parent_subscription', 'suspended', 'resuming'),
  ('parent_subscription', 'resuming', 'active'),
  ('parent_subscription', 'resuming', 'suspended');

CREATE TRIGGER state_moves_forward BEFORE UPDATE OF state ON public.wishes
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_transition('wish');
CREATE TRIGGER state_moves_forward BEFORE UPDATE OF state ON public.wish_triggers
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_transition('wish_trigger');
CREATE TRIGGER state_moves_forward BEFORE UPDATE OF state ON public.parent_subscriptions
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_transition('parent_subscription');
--> statement-breakpoint

-- What a row says never changes after it is written: only the listed columns move.
CREATE FUNCTION kin_private.assert_wish_rows_fixed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_moving text[] := CASE TG_TABLE_NAME
      WHEN 'wishes' THEN ARRAY['state', 'confirmed_at', 'in_force_at', 'closed_at']
      WHEN 'wish_triggers' THEN ARRAY['state', 'active_at', 'closed_at', 'organizer_before', 'organizer_during']
      ELSE ARRAY['state', 'held_by', 'changed_at'] END;
  BEGIN
    IF (to_jsonb(NEW) - v_moving) IS DISTINCT FROM (to_jsonb(OLD) - v_moving) THEN
      RAISE EXCEPTION 'kin: % % cannot change what it says after it is written', TG_TABLE_NAME, OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER content_fixed BEFORE UPDATE ON public.wishes
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_wish_rows_fixed();
CREATE TRIGGER content_fixed BEFORE UPDATE ON public.wish_triggers
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_wish_rows_fixed();
CREATE TRIGGER content_fixed BEFORE UPDATE ON public.parent_subscriptions
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_wish_rows_fixed();
--> statement-breakpoint

-- A signature is over the wish's own digest, given in the seat the member holds:
-- the parent for her own wish, a witness who shares the cost for anyone's.
CREATE FUNCTION kin_private.assert_wish_signature_fits() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_wish public.wishes;
    v_role public.circle_role;
  BEGIN
    SELECT * INTO v_wish FROM public.wishes WHERE circle_id = NEW.circle_id AND id = NEW.wish_id;
    SELECT role INTO v_role FROM public.members WHERE circle_id = NEW.circle_id AND id = NEW.member_id AND status = 'active';
    IF v_wish.id IS NULL OR NEW.digest IS DISTINCT FROM v_wish.digest OR v_role IS DISTINCT FROM NEW.role THEN
      RAISE EXCEPTION 'kin: a wish is signed over its own digest, in the seat the member holds' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT ((NEW.capacity = 'parent' AND v_role = 'parent') OR (NEW.capacity = 'witness' AND v_role IN ('organizer', 'contributor'))) THEN
      RAISE EXCEPTION 'kin: that seat cannot sign a wish in that capacity' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER signature_fits_the_seat BEFORE INSERT ON public.wish_signatures
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_wish_signature_fits();
--> statement-breakpoint

-- A version's digest: SHA-256 over the digest before it and the version's content,
-- as jsonb prints it. packages/db/src/wishes.ts computes the same, and a test holds the two equal.
CREATE FUNCTION kin_private.wish_digest(p_previous text, p_key uuid, p_version integer, p_quote text, p_said date, p_trigger text, p_rule jsonb) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public
  AS $$
    SELECT encode(sha256(convert_to(coalesce(p_previous, '') || E'\n' || jsonb_build_array(p_key::text, p_version, p_quote, p_said::text, p_trigger, p_rule)::text, 'UTF8')), 'hex')
  $$;
--> statement-breakpoint

-- Whether a trigger is reported or active in the circle: while one is, her wishes stay as they are.
CREATE FUNCTION kin_private.wish_trigger_open(p_circle uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$ SELECT EXISTS (SELECT 1 FROM public.wish_triggers WHERE circle_id = p_circle AND state IN ('reported', 'active')) $$;
--> statement-breakpoint

-- Whether a rule is one the record can hold, for this circle: the same checks as
-- checkWishDraft in packages/domain, against the circle's own rows.
CREATE FUNCTION kin_private.wish_rule_fits(p_circle uuid, p_rule jsonb) RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_kind text := p_rule ->> 'kind';
    v_ids text[];
    v_cents numeric;
  BEGIN
    IF jsonb_typeof(p_rule) IS DISTINCT FROM 'object' THEN
      RETURN false;
    END IF;
    CASE v_kind
      WHEN 'keep_paying' THEN
        RETURN (p_rule - ARRAY['kind', 'payeeId']) = '{}'::jsonb AND jsonb_typeof(p_rule -> 'payeeId') = 'string'
          AND (p_rule ->> 'payeeId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND EXISTS (
            SELECT 1 FROM public.payees p JOIN public.members m ON m.circle_id = p.circle_id AND m.id = p.member_id
            WHERE p.circle_id = p_circle AND p.id = (p_rule ->> 'payeeId')::uuid AND p.caregiver_rate_cents_per_hour IS NOT NULL AND m.role = 'caregiver'
          );
      WHEN 'pause_discretionary' THEN
        RETURN (p_rule - 'kind') = '{}'::jsonb;
      WHEN 'suspend_subscriptions' THEN
        IF (p_rule - ARRAY['kind', 'subscriptionIds']) <> '{}'::jsonb OR jsonb_typeof(p_rule -> 'subscriptionIds') IS DISTINCT FROM 'array'
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_rule -> 'subscriptionIds') AS e WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
          RETURN false;
        END IF;
        SELECT array_agg(e) INTO v_ids FROM jsonb_array_elements_text(p_rule -> 'subscriptionIds') AS e;
        RETURN v_ids IS NOT NULL AND cardinality(v_ids) <= 12 AND cardinality(v_ids) = (SELECT count(DISTINCT x) FROM unnest(v_ids) AS x)
          AND cardinality(v_ids) = (SELECT count(*) FROM public.parent_subscriptions s WHERE s.circle_id = p_circle AND s.id::text = ANY (v_ids));
      WHEN 'new_payee_approvals' THEN
        IF (p_rule - ARRAY['kind', 'aboveCents', 'approverMemberIds']) <> '{}'::jsonb OR jsonb_typeof(p_rule -> 'aboveCents') IS DISTINCT FROM 'number'
           OR jsonb_typeof(p_rule -> 'approverMemberIds') IS DISTINCT FROM 'array'
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_rule -> 'approverMemberIds') AS e WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
          RETURN false;
        END IF;
        v_cents := (p_rule ->> 'aboveCents')::numeric;
        IF v_cents <> trunc(v_cents) OR v_cents <= 0 OR v_cents > 10000000000 THEN
          RETURN false;
        END IF;
        SELECT array_agg(e) INTO v_ids FROM jsonb_array_elements_text(p_rule -> 'approverMemberIds') AS e;
        RETURN v_ids IS NOT NULL AND cardinality(v_ids) >= 2 AND cardinality(v_ids) = (SELECT count(DISTINCT x) FROM unnest(v_ids) AS x)
          AND cardinality(v_ids) = (SELECT count(*) FROM public.members m WHERE m.circle_id = p_circle AND m.id::text = ANY (v_ids) AND m.status = 'active' AND m.role IN ('organizer', 'contributor'));
      WHEN 'successor' THEN
        RETURN (p_rule - ARRAY['kind', 'memberId']) = '{}'::jsonb AND jsonb_typeof(p_rule -> 'memberId') = 'string'
          AND (p_rule ->> 'memberId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND EXISTS (SELECT 1 FROM public.members m WHERE m.circle_id = p_circle AND m.id = (p_rule ->> 'memberId')::uuid AND m.status = 'active' AND m.role = 'contributor');
      ELSE
        RETURN false;
    END CASE;
  END
  $$;
--> statement-breakpoint

-- Keeps a recording of the parent saying a wish, in her own voice, as WAV. The
-- parent only, while no trigger is open, a few dozen a day at most.
CREATE FUNCTION kin_private.store_wish_recording(p_circle uuid, p_audio bytea) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_id uuid := gen_random_uuid();
  BEGIN
    IF kin_private.my_role(p_circle) IS DISTINCT FROM 'parent' OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: keeping a recording refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active' FOR UPDATE;
    IF kin_private.wish_trigger_open(p_circle) THEN
      RAISE EXCEPTION 'kin: her wishes stay as they are while a trigger is open' USING ERRCODE = 'KW001';
    END IF;
    IF p_audio IS NULL OR substring(p_audio FROM 1 FOR 4) <> '\x52494646'::bytea OR substring(p_audio FROM 9 FOR 4) <> '\x57415645'::bytea THEN
      RAISE EXCEPTION 'kin: a recording is a WAV file' USING ERRCODE = 'check_violation';
    END IF;
    IF (SELECT count(*) FROM public.wish_recordings WHERE circle_id = p_circle AND created_at > now() - interval '1 day') >= 40 THEN
      RAISE EXCEPTION 'kin: too many recordings today' USING ERRCODE = 'KW007';
    END IF;
    INSERT INTO public.wish_recordings (id, circle_id, recorded_by, content_type, audio, sha256, simulated)
      VALUES (v_id, p_circle, v_me, 'audio/wav', p_audio, encode(sha256(p_audio), 'hex'), v_circle.demo);
    RETURN v_id;
  END
  $$;
--> statement-breakpoint

-- Writes a draft of a wish, as Kin read it back to her: her words, when it
-- applies and the rule. The parent only, while no trigger is open. With a
-- `wishKey` it is the next version of that wish, chained to the version before
-- it; a wish she withdrew is not changed, it is said again as a new one.
CREATE FUNCTION kin_private.record_wish(p_circle uuid, p_wish jsonb) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_id uuid := gen_random_uuid();
    v_key uuid;
    v_version integer := 1;
    v_previous text;
    v_latest public.wishes;
    v_recording uuid;
    v_said date;
    v_trigger text;
    v_rule jsonb;
    v_quote text;
  BEGIN
    IF kin_private.my_role(p_circle) IS DISTINCT FROM 'parent' OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: saying a wish refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active' FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: saying a wish refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF kin_private.wish_trigger_open(p_circle) THEN
      RAISE EXCEPTION 'kin: her wishes stay as they are while a trigger is open' USING ERRCODE = 'KW001';
    END IF;
    IF jsonb_typeof(p_wish) IS DISTINCT FROM 'object' OR (p_wish - ARRAY['quote', 'trigger', 'rule', 'recordingId', 'wishKey']) <> '{}'::jsonb
       OR jsonb_typeof(p_wish -> 'quote') IS DISTINCT FROM 'string' OR jsonb_typeof(p_wish -> 'trigger') IS DISTINCT FROM 'string'
       OR coalesce(jsonb_typeof(p_wish -> 'recordingId'), 'null') NOT IN ('string', 'null') OR coalesce(jsonb_typeof(p_wish -> 'wishKey'), 'null') NOT IN ('string', 'null')
       OR coalesce(p_wish ->> 'recordingId', '00000000-0000-0000-0000-000000000000') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR coalesce(p_wish ->> 'wishKey', '00000000-0000-0000-0000-000000000000') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR NOT kin_private.wish_rule_fits(p_circle, p_wish -> 'rule') THEN
      RAISE EXCEPTION 'kin: that is not a wish the record can hold' USING ERRCODE = 'check_violation';
    END IF;
    v_quote := btrim(regexp_replace(p_wish ->> 'quote', '\s+', ' ', 'g'));
    v_trigger := p_wish ->> 'trigger';
    v_rule := p_wish -> 'rule';
    v_recording := (p_wish ->> 'recordingId')::uuid;
    IF v_recording IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.wish_recordings WHERE circle_id = p_circle AND id = v_recording AND recorded_by = v_me) THEN
      RAISE EXCEPTION 'kin: that recording is not hers' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_key := coalesce((p_wish ->> 'wishKey')::uuid, gen_random_uuid());
    IF p_wish ->> 'wishKey' IS NOT NULL THEN
      SELECT * INTO v_latest FROM public.wishes WHERE circle_id = p_circle AND wish_key = v_key ORDER BY version DESC LIMIT 1 FOR UPDATE;
      IF v_latest.id IS NULL OR v_latest.state = 'withdrawn' THEN
        RAISE EXCEPTION 'kin: there is no wish of hers to change' USING ERRCODE = 'KW003';
      END IF;
      IF v_latest.state IN ('draft', 'confirmed') THEN
        RAISE EXCEPTION 'kin: a change of this wish is already waiting' USING ERRCODE = 'KW002';
      END IF;
      v_version := v_latest.version + 1;
      v_previous := v_latest.digest;
    END IF;
    v_said := (coalesce(v_circle.clock_at, now()) AT TIME ZONE v_circle.timezone)::date;
    INSERT INTO public.wishes (id, circle_id, wish_key, version, quote, said_on, trigger, rule_kind, rule, recording_id, digest, previous_digest, simulated, created_by, created_at)
      VALUES (v_id, p_circle, v_key, v_version, v_quote, v_said, v_trigger, v_rule ->> 'kind', v_rule, v_recording,
              kin_private.wish_digest(v_previous, v_key, v_version, v_quote, v_said, v_trigger, v_rule), v_previous, v_circle.demo, v_me,
              date_trunc('second', coalesce(v_circle.clock_at, now())));
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'wish.drafted', 'wish', v_id,
              jsonb_build_object('wishKey', v_key, 'version', v_version, 'digest', (SELECT digest FROM public.wishes WHERE id = v_id)), 'web');
    RETURN v_id;
  END
  $$;
--> statement-breakpoint

-- She confirms what Kin read back: her signature over the draft's digest. The
-- parent only, on a draft, while no trigger is open. Confirming twice changes nothing.
CREATE FUNCTION kin_private.confirm_wish(p_circle uuid, p_wish uuid, p_method public.approval_method) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_wish public.wishes;
    v_now timestamptz;
  BEGIN
    IF kin_private.my_role(p_circle) IS DISTINCT FROM 'parent' OR v_me IS NULL OR p_method NOT IN ('app', 'voice') THEN
      RAISE EXCEPTION 'kin: confirming a wish refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active' FOR UPDATE;
    SELECT * INTO v_wish FROM public.wishes WHERE circle_id = p_circle AND id = p_wish FOR UPDATE;
    IF v_circle.id IS NULL OR v_wish.id IS NULL THEN
      RAISE EXCEPTION 'kin: confirming a wish refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF kin_private.wish_trigger_open(p_circle) THEN
      RAISE EXCEPTION 'kin: her wishes stay as they are while a trigger is open' USING ERRCODE = 'KW001';
    END IF;
    IF v_wish.state = 'confirmed' AND EXISTS (SELECT 1 FROM public.wish_signatures WHERE wish_id = p_wish AND member_id = v_me) THEN
      RETURN;
    END IF;
    IF v_wish.state <> 'draft' THEN
      RAISE EXCEPTION 'kin: only a draft is confirmed' USING ERRCODE = 'KW003';
    END IF;
    v_now := date_trunc('second', coalesce(v_circle.clock_at, now()));
    INSERT INTO public.wish_signatures (id, circle_id, wish_id, member_id, role, capacity, digest, method, signed_at)
      VALUES (gen_random_uuid(), p_circle, p_wish, v_me, 'parent', 'parent', v_wish.digest, p_method, v_now);
    UPDATE public.wishes SET state = 'confirmed', confirmed_at = v_now WHERE circle_id = p_circle AND id = p_wish;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'wish.confirmed', 'wish', p_wish, jsonb_build_object('digest', v_wish.digest, 'method', p_method), 'web');
  END
  $$;
--> statement-breakpoint

-- A family member who shares the cost witnesses a wish she confirmed. The second
-- witness puts it in force and supersedes the version before it. Never the
-- parent, never the successor a wish names, and not while a trigger is open.
CREATE FUNCTION kin_private.witness_wish(p_circle uuid, p_wish uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_wish public.wishes;
    v_now timestamptz;
    v_witnesses integer;
  BEGIN
    IF v_me IS NULL OR v_role IS NULL OR v_role NOT IN ('organizer', 'contributor') THEN
      RAISE EXCEPTION 'kin: witnessing a wish refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active' FOR UPDATE;
    SELECT * INTO v_wish FROM public.wishes WHERE circle_id = p_circle AND id = p_wish FOR UPDATE;
    IF v_circle.id IS NULL OR v_wish.id IS NULL OR (v_wish.rule_kind = 'successor' AND v_wish.rule ->> 'memberId' = v_me::text) THEN
      RAISE EXCEPTION 'kin: witnessing a wish refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF kin_private.wish_trigger_open(p_circle) THEN
      RAISE EXCEPTION 'kin: her wishes stay as they are while a trigger is open' USING ERRCODE = 'KW001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.wish_signatures WHERE wish_id = p_wish AND member_id = v_me) THEN
      RETURN v_wish.state;
    END IF;
    IF v_wish.state <> 'confirmed' THEN
      RAISE EXCEPTION 'kin: only a wish she confirmed is witnessed' USING ERRCODE = 'KW003';
    END IF;
    v_now := date_trunc('second', coalesce(v_circle.clock_at, now()));
    INSERT INTO public.wish_signatures (id, circle_id, wish_id, member_id, role, capacity, digest, method, signed_at)
      VALUES (gen_random_uuid(), p_circle, p_wish, v_me, v_role, 'witness', v_wish.digest, 'app', v_now);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'wish.witnessed', 'wish', p_wish, jsonb_build_object('digest', v_wish.digest), 'web');
    SELECT count(DISTINCT member_id) INTO v_witnesses FROM public.wish_signatures
      WHERE wish_id = p_wish AND capacity = 'witness' AND digest = v_wish.digest AND role IN ('organizer', 'contributor');
    IF v_witnesses < 2 THEN
      RETURN 'confirmed';
    END IF;
    UPDATE public.wishes SET state = 'superseded', closed_at = v_now WHERE circle_id = p_circle AND wish_key = v_wish.wish_key AND state = 'in_force';
    UPDATE public.wishes SET state = 'in_force', in_force_at = v_now WHERE circle_id = p_circle AND id = p_wish;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'wish.in_force', 'wish', p_wish,
              jsonb_build_object('digest', v_wish.digest, 'previousDigest', v_wish.previous_digest, 'version', v_wish.version), 'web');
    RETURN 'in_force';
  END
  $$;
--> statement-breakpoint

-- She takes a wish back. The parent only, while no trigger is open. What it
-- said stays on the record; it no longer applies. Withdrawing twice changes nothing.
CREATE FUNCTION kin_private.withdraw_wish(p_circle uuid, p_wish uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_wish public.wishes;
  BEGIN
    IF kin_private.my_role(p_circle) IS DISTINCT FROM 'parent' OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: withdrawing a wish refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active' FOR UPDATE;
    SELECT * INTO v_wish FROM public.wishes WHERE circle_id = p_circle AND id = p_wish FOR UPDATE;
    IF v_circle.id IS NULL OR v_wish.id IS NULL THEN
      RAISE EXCEPTION 'kin: withdrawing a wish refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_wish.state = 'withdrawn' THEN
      RETURN;
    END IF;
    IF kin_private.wish_trigger_open(p_circle) THEN
      RAISE EXCEPTION 'kin: her wishes stay as they are while a trigger is open' USING ERRCODE = 'KW001';
    END IF;
    IF v_wish.state = 'superseded' THEN
      RAISE EXCEPTION 'kin: a superseded version is history already' USING ERRCODE = 'KW003';
    END IF;
    UPDATE public.wishes SET state = 'withdrawn', closed_at = date_trunc('second', coalesce(v_circle.clock_at, now())) WHERE circle_id = p_circle AND id = p_wish;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'wish.withdrawn', 'wish', p_wish, jsonb_build_object('digest', v_wish.digest), 'web');
  END
  $$;
--> statement-breakpoint

-- Whether a PayPal subscription, as PayPal described it (`p_owner`: its
-- subscriber's payer ID and the circle and member its custom ID names), is the
-- parent's: one Kin made for this circle's parent, or one whose subscriber is
-- the PayPal account the parent verified with Kin. The one rule, asked when a
-- subscription is added and by the worker again before every change.
CREATE FUNCTION kin_private.subscription_is_parents(p_circle uuid, p_owner jsonb) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT coalesce(bool_or(
      (p_owner ->> 'circleId' = p_circle::text AND p_owner ->> 'memberId' = m.id::text)
      OR (u.paypal_payer_id IS NOT NULL AND p_owner ->> 'payerId' = u.paypal_payer_id)
    ), false)
    FROM public.members m LEFT JOIN public.users u ON u.id = m.user_id
    WHERE m.circle_id = p_circle AND m.role = 'parent' AND m.status = 'active' AND jsonb_typeof(p_owner) = 'object'
  $$;
--> statement-breakpoint

-- A PayPal subscription is one family's and one purpose's: never a parent's
-- subscription and a member's monthly share at once, in any circle.
CREATE FUNCTION kin_private.assert_subscription_once() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NEW.paypal_subscription_id IS NOT NULL AND (
      (TG_TABLE_NAME = 'parent_subscriptions' AND EXISTS (SELECT 1 FROM public.monthly_shares WHERE paypal_subscription_id = NEW.paypal_subscription_id))
      OR (TG_TABLE_NAME = 'monthly_shares' AND EXISTS (SELECT 1 FROM public.parent_subscriptions WHERE paypal_subscription_id = NEW.paypal_subscription_id))) THEN
      RAISE EXCEPTION 'kin: that PayPal subscription is already known to Kin' USING ERRCODE = 'unique_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER paypal_subscription_once BEFORE INSERT OR UPDATE OF paypal_subscription_id ON public.parent_subscriptions
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_subscription_once();
CREATE TRIGGER paypal_subscription_once BEFORE INSERT OR UPDATE OF paypal_subscription_id ON public.monthly_shares
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_subscription_once();
--> statement-breakpoint

-- Tells Kin about a subscription the parent pays, so a wish can name it. The
-- organizer only. A demo circle's is simulated and names no PayPal
-- subscription. A real circle's names one only when PayPal described it as the
-- parent's (`p_owner`, read from PayPal by the web app); without one it is not
-- linked, and Kin never calls PayPal for it.
CREATE FUNCTION kin_private.add_parent_subscription(p_circle uuid, p_name text, p_cents bigint, p_paypal_id text, p_owner jsonb) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_id uuid := gen_random_uuid();
  BEGIN
    IF kin_private.my_role(p_circle) IS DISTINCT FROM 'organizer' OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: adding a subscription refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: adding a subscription refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_circle.demo AND p_paypal_id IS NOT NULL THEN
      RAISE EXCEPTION 'kin: a simulated subscription names no PayPal subscription' USING ERRCODE = 'check_violation';
    END IF;
    IF p_paypal_id IS NOT NULL AND NOT kin_private.subscription_is_parents(p_circle, p_owner) THEN
      RAISE EXCEPTION 'kin: PayPal does not say that subscription is the parent''s' USING ERRCODE = 'KW008';
    END IF;
    IF p_paypal_id IS NOT NULL AND (EXISTS (SELECT 1 FROM public.parent_subscriptions WHERE paypal_subscription_id = p_paypal_id)
                                    OR EXISTS (SELECT 1 FROM public.monthly_shares WHERE paypal_subscription_id = p_paypal_id)) THEN
      RAISE EXCEPTION 'kin: that PayPal subscription is already known to Kin' USING ERRCODE = 'KW009';
    END IF;
    INSERT INTO public.parent_subscriptions (id, circle_id, name, monthly_cents, paypal_subscription_id, simulated)
      VALUES (v_id, p_circle, btrim(p_name), p_cents, p_paypal_id, v_circle.demo);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'parent_subscription.added', 'parent_subscription', v_id, '{}'::jsonb, 'web');
    RETURN v_id;
  END
  $$;
--> statement-breakpoint

-- What a trigger does when it becomes active (p_on) and when it ends. Plain
-- rules over her wishes in force, as packages/domain/src/wishes.ts applies
-- them; a test holds the two equal. A demo circle's subscriptions move at once
-- and are simulated; a real one's wait for the worker to read PayPal's record.
CREATE FUNCTION kin_private.apply_wish_trigger(p_circle uuid, p_trigger uuid, p_on boolean, p_now timestamptz) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_trigger public.wish_triggers;
    v_sub public.parent_subscriptions;
    v_successor uuid;
    v_organizer uuid;
  BEGIN
    SELECT * INTO v_trigger FROM public.wish_triggers WHERE circle_id = p_circle AND id = p_trigger;
    IF p_on THEN
      FOR v_sub IN
        SELECT s.* FROM public.parent_subscriptions s
        WHERE s.circle_id = p_circle AND s.state = 'active' AND s.id::text IN (
          SELECT jsonb_array_elements_text(w.rule -> 'subscriptionIds') FROM public.wishes w
          WHERE w.circle_id = p_circle AND w.state = 'in_force' AND w.rule_kind = 'suspend_subscriptions' AND w.trigger IN (v_trigger.event, 'either'))
        ORDER BY s.created_at, s.id FOR UPDATE
      LOOP
        -- One not linked to PayPal is left running: Kin cannot stop it, and the screen tells the family to.
        IF NOT v_sub.simulated AND v_sub.paypal_subscription_id IS NULL THEN
          INSERT INTO public.audit_log (id, circle_id, actor, action, subject_type, subject_id, details, origin)
            VALUES (gen_random_uuid(), p_circle, 'service', 'wish.subscription_not_linked', 'parent_subscription', v_sub.id, jsonb_build_object('triggerId', p_trigger), 'web');
          CONTINUE;
        END IF;
        UPDATE public.parent_subscriptions SET state = 'suspending', held_by = p_trigger, changed_at = p_now WHERE id = v_sub.id;
        IF v_sub.simulated THEN
          UPDATE public.parent_subscriptions SET state = 'suspended' WHERE id = v_sub.id;
        ELSE
          INSERT INTO public.outbox (id, circle_id, topic, payload)
            VALUES (gen_random_uuid(), p_circle, 'wish.subscription', jsonb_build_object('subscriptionId', v_sub.id, 'action', 'suspend'));
        END IF;
        INSERT INTO public.audit_log (id, circle_id, actor, action, subject_type, subject_id, details, origin)
          VALUES (gen_random_uuid(), p_circle, 'service', 'wish.subscription_suspended', 'parent_subscription', v_sub.id,
                  jsonb_build_object('triggerId', p_trigger, 'simulated', v_sub.simulated), 'web');
      END LOOP;
      -- The latest successor she named, if they can still run the circle.
      SELECT (w.rule ->> 'memberId')::uuid INTO v_successor FROM public.wishes w
        WHERE w.circle_id = p_circle AND w.state = 'in_force' AND w.rule_kind = 'successor' AND w.trigger IN (v_trigger.event, 'either')
        ORDER BY w.said_on DESC, w.version DESC, w.id DESC LIMIT 1;
      SELECT id INTO v_organizer FROM public.members WHERE circle_id = p_circle AND role = 'organizer' AND status = 'active' ORDER BY joined_at, id LIMIT 1;
      IF v_successor IS NOT NULL AND v_organizer IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.members WHERE circle_id = p_circle AND id = v_successor AND role = 'contributor' AND status = 'active') THEN
        UPDATE public.members SET role = 'contributor' WHERE circle_id = p_circle AND id = v_organizer;
        UPDATE public.members SET role = 'organizer' WHERE circle_id = p_circle AND id = v_successor;
        UPDATE public.wish_triggers SET organizer_before = v_organizer, organizer_during = v_successor WHERE id = p_trigger;
        INSERT INTO public.audit_log (id, circle_id, actor, action, subject_type, subject_id, details, origin)
          VALUES (gen_random_uuid(), p_circle, 'service', 'wish.successor_seated', 'member', v_successor,
                  jsonb_build_object('triggerId', p_trigger, 'organizerBefore', v_organizer), 'web');
      END IF;
      RETURN;
    END IF;
    FOR v_sub IN
      SELECT * FROM public.parent_subscriptions WHERE circle_id = p_circle AND held_by = p_trigger AND state = 'suspended' ORDER BY created_at, id FOR UPDATE
    LOOP
      UPDATE public.parent_subscriptions SET state = 'resuming', changed_at = p_now WHERE id = v_sub.id;
      IF v_sub.simulated THEN
        UPDATE public.parent_subscriptions SET state = 'active', held_by = NULL WHERE id = v_sub.id;
      ELSE
        INSERT INTO public.outbox (id, circle_id, topic, payload)
          VALUES (gen_random_uuid(), p_circle, 'wish.subscription', jsonb_build_object('subscriptionId', v_sub.id, 'action', 'activate'));
      END IF;
      INSERT INTO public.audit_log (id, circle_id, actor, action, subject_type, subject_id, details, origin)
        VALUES (gen_random_uuid(), p_circle, 'service', 'wish.subscription_resumed', 'parent_subscription', v_sub.id,
                jsonb_build_object('triggerId', p_trigger, 'simulated', v_sub.simulated), 'web');
    END LOOP;
    -- The seat goes back only if nobody moved it since.
    IF v_trigger.organizer_before IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.members WHERE circle_id = p_circle AND id = v_trigger.organizer_during AND role = 'organizer')
       AND EXISTS (SELECT 1 FROM public.members WHERE circle_id = p_circle AND id = v_trigger.organizer_before AND role = 'contributor' AND status = 'active') THEN
      UPDATE public.members SET role = 'contributor' WHERE circle_id = p_circle AND id = v_trigger.organizer_during;
      UPDATE public.members SET role = 'organizer' WHERE circle_id = p_circle AND id = v_trigger.organizer_before;
      INSERT INTO public.audit_log (id, circle_id, actor, action, subject_type, subject_id, details, origin)
        VALUES (gen_random_uuid(), p_circle, 'service', 'wish.successor_returned', 'member', v_trigger.organizer_before,
                jsonb_build_object('triggerId', p_trigger), 'web');
    END IF;
  END
  $$;
--> statement-breakpoint

-- One person's word: she went into hospital or a care home (`start`), or she is
-- home (`end`). The first word reports a trigger; a second from someone who
-- may attest it makes it active, or ends it, and applies or undoes what her
-- wishes say. The family attests either event; the caregiver a hospital
-- admission only; never the parent, never an observer. The moment is the
-- circle's own. Saying the same twice changes nothing.
CREATE FUNCTION kin_private.attest_wish_trigger(p_circle uuid, p_event text, p_stance text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_trigger public.wish_triggers;
    v_now timestamptz;
    v_total integer;
    v_family integer;
    v_excluded uuid[];
    v_interested uuid[];
  BEGIN
    IF v_me IS NULL OR v_role IS NULL OR v_role NOT IN ('organizer', 'contributor', 'caregiver') THEN
      RAISE EXCEPTION 'kin: attesting refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_event IS NULL OR p_event NOT IN ('hospital', 'care_home') OR p_stance IS NULL OR p_stance NOT IN ('start', 'end') THEN
      RAISE EXCEPTION 'kin: not an event Kin knows' USING ERRCODE = 'check_violation';
    END IF;
    IF v_role = 'caregiver' AND p_event <> 'hospital' THEN
      RAISE EXCEPTION 'kin: a caregiver attests a hospital admission only' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active' FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: attesting refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_now := date_trunc('second', coalesce(v_circle.clock_at, now()));
    SELECT * INTO v_trigger FROM public.wish_triggers WHERE circle_id = p_circle AND state IN ('reported', 'active') FOR UPDATE;
    IF p_stance = 'start' THEN
      IF v_trigger.id IS NULL THEN
        INSERT INTO public.wish_triggers (id, circle_id, event, reported_by, reported_at, simulated)
          VALUES (gen_random_uuid(), p_circle, p_event, v_me, v_now, v_circle.demo) RETURNING * INTO v_trigger;
        INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
          VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'wish_trigger.reported', 'wish_trigger', v_trigger.id, jsonb_build_object('event', p_event), 'web');
      ELSIF v_trigger.event <> p_event THEN
        RAISE EXCEPTION 'kin: a different event is reported already' USING ERRCODE = 'KW005';
      ELSIF v_trigger.state = 'active' THEN
        RAISE EXCEPTION 'kin: it is active already' USING ERRCODE = 'KW004';
      END IF;
    ELSE
      IF v_trigger.id IS NULL OR v_trigger.state <> 'active' THEN
        RAISE EXCEPTION 'kin: nothing is active to end' USING ERRCODE = 'KW006';
      END IF;
      IF v_trigger.event <> p_event THEN
        RAISE EXCEPTION 'kin: a different event is active' USING ERRCODE = 'KW005';
      END IF;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.wish_attestations WHERE trigger_id = v_trigger.id AND member_id = v_me AND stance = p_stance) THEN
      INSERT INTO public.wish_attestations (id, circle_id, trigger_id, member_id, role, stance, attested_at)
        VALUES (gen_random_uuid(), p_circle, v_trigger.id, v_me, v_role, p_stance, v_now);
      INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
        VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'wish_trigger.attested', 'wish_trigger', v_trigger.id, jsonb_build_object('stance', p_stance, 'role', v_role), 'web');
    END IF;
    -- The domain's attestationConflicts: her wishes are frozen while a trigger is open, so these stay as they were reported.
    -- The successor a wish names is raised by the trigger; the caregiver a keep-paying wish names is protected by it.
    SELECT coalesce(array_agg(DISTINCT (w.rule ->> 'memberId')::uuid), '{}') INTO v_excluded FROM public.wishes w
      WHERE w.circle_id = p_circle AND w.state = 'in_force' AND w.rule_kind = 'successor' AND w.trigger IN (v_trigger.event, 'either');
    SELECT coalesce(array_agg(DISTINCT p.member_id), '{}') INTO v_interested FROM public.wishes w
      JOIN public.payees p ON p.circle_id = w.circle_id AND p.id = (w.rule ->> 'payeeId')::uuid
      WHERE w.circle_id = p_circle AND w.state = 'in_force' AND w.rule_kind = 'keep_paying' AND w.trigger IN (v_trigger.event, 'either') AND p.member_id IS NOT NULL;
    -- The domain's attestationMet: two different people who may attest it, one of them family. To start it,
    -- nobody who stands to gain counts: neither the successor it would seat nor the caregiver it would keep paid.
    SELECT count(DISTINCT member_id), count(DISTINCT member_id) FILTER (WHERE role IN ('organizer', 'contributor'))
      INTO v_total, v_family FROM public.wish_attestations
      WHERE trigger_id = v_trigger.id AND stance = p_stance AND (role IN ('organizer', 'contributor') OR (role = 'caregiver' AND v_trigger.event = 'hospital'))
        AND (p_stance = 'end' OR NOT (member_id = ANY (v_excluded || v_interested)));
    IF v_total >= 2 AND v_family >= 1 THEN
      IF p_stance = 'start' AND v_trigger.state = 'reported' THEN
        UPDATE public.wish_triggers SET state = 'active', active_at = v_now WHERE id = v_trigger.id;
        PERFORM kin_private.apply_wish_trigger(p_circle, v_trigger.id, true, v_now);
        INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
          VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'wish_trigger.active', 'wish_trigger', v_trigger.id, jsonb_build_object('event', v_trigger.event), 'web');
      ELSIF p_stance = 'end' AND v_trigger.state = 'active' THEN
        UPDATE public.wish_triggers SET state = 'ended', closed_at = v_now WHERE id = v_trigger.id;
        PERFORM kin_private.apply_wish_trigger(p_circle, v_trigger.id, false, v_now);
        INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
          VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'wish_trigger.ended', 'wish_trigger', v_trigger.id, jsonb_build_object('event', v_trigger.event), 'web');
      END IF;
    END IF;
    RETURN jsonb_build_object('triggerId', v_trigger.id, 'state', (SELECT state FROM public.wish_triggers WHERE id = v_trigger.id));
  END
  $$;
--> statement-breakpoint

-- Takes back a report nobody confirmed: the one who made it, or the organizer.
-- Nothing had happened, so nothing is undone.
CREATE FUNCTION kin_private.dismiss_wish_trigger(p_circle uuid, p_trigger uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_trigger public.wish_triggers;
  BEGIN
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active' FOR UPDATE;
    SELECT * INTO v_trigger FROM public.wish_triggers WHERE circle_id = p_circle AND id = p_trigger FOR UPDATE;
    IF v_me IS NULL OR v_circle.id IS NULL OR v_trigger.id IS NULL OR NOT (v_role = 'organizer' OR v_trigger.reported_by = v_me) THEN
      RAISE EXCEPTION 'kin: dismissing a report refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_trigger.state = 'dismissed' THEN
      RETURN;
    END IF;
    IF v_trigger.state <> 'reported' THEN
      RAISE EXCEPTION 'kin: only a report nobody confirmed is dismissed' USING ERRCODE = 'KW004';
    END IF;
    UPDATE public.wish_triggers SET state = 'dismissed', closed_at = date_trunc('second', coalesce(v_circle.clock_at, now())) WHERE id = p_trigger;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'wish_trigger.dismissed', 'wish_trigger', p_trigger, '{}'::jsonb, 'web');
  END
  $$;
--> statement-breakpoint

-- The parent's own word that she is fine. Her wishes are hers to lift: a report
-- is dismissed and an active trigger ends at once, undoing what it started, and
-- the record keeps that it was her word. The parent only, in her own seat.
CREATE FUNCTION kin_private.parent_says_fine(p_circle uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_trigger public.wish_triggers;
    v_now timestamptz;
    v_to text;
  BEGIN
    IF kin_private.my_role(p_circle) IS DISTINCT FROM 'parent' OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: only the parent says she is fine' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active' FOR UPDATE;
    SELECT * INTO v_trigger FROM public.wish_triggers WHERE circle_id = p_circle AND state IN ('reported', 'active') FOR UPDATE;
    IF v_circle.id IS NULL OR v_trigger.id IS NULL THEN
      RAISE EXCEPTION 'kin: nothing is reported or in effect' USING ERRCODE = 'KW006';
    END IF;
    v_now := date_trunc('second', coalesce(v_circle.clock_at, now()));
    v_to := CASE v_trigger.state WHEN 'reported' THEN 'dismissed' ELSE 'ended' END;
    UPDATE public.wish_triggers SET state = v_to, closed_at = v_now WHERE id = v_trigger.id;
    IF v_to = 'ended' THEN
      PERFORM kin_private.apply_wish_trigger(p_circle, v_trigger.id, false, v_now);
    END IF;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'wish_trigger.parent_fine', 'wish_trigger', v_trigger.id, jsonb_build_object('state', v_to), 'web');
    RETURN v_to;
  END
  $$;
--> statement-breakpoint

-- Whether the person asking stands to gain if `p_event` started, so their word
-- would not count toward it: the same two rules attest_wish_trigger counts by.
-- A caregiver cannot read her wishes; this tells them only that much, so the
-- screen does not offer a word that would not count.
CREATE FUNCTION kin_private.my_wish_stake(p_circle uuid, p_event text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.wishes w
      LEFT JOIN public.payees p ON w.rule_kind = 'keep_paying' AND p.circle_id = w.circle_id AND p.id = (w.rule ->> 'payeeId')::uuid
      WHERE w.circle_id = p_circle AND w.state = 'in_force' AND w.trigger IN (p_event, 'either')
        AND kin_private.my_member_id(p_circle) IS NOT NULL
        AND ((w.rule_kind = 'successor' AND w.rule ->> 'memberId' = kin_private.my_member_id(p_circle)::text)
          OR (w.rule_kind = 'keep_paying' AND p.member_id = kin_private.my_member_id(p_circle)))
    )
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.my_wish_stake(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.my_wish_stake(uuid, text) TO kin_app;
REVOKE ALL ON FUNCTION kin_private.parent_says_fine(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.parent_says_fine(uuid) TO kin_app;
REVOKE ALL ON FUNCTION kin_private.assert_wish_rows_fixed() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.assert_wish_signature_fits() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.wish_digest(text, uuid, integer, text, date, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.wish_trigger_open(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.wish_rule_fits(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.store_wish_recording(uuid, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.record_wish(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.confirm_wish(uuid, uuid, public.approval_method) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.witness_wish(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.withdraw_wish(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.add_parent_subscription(uuid, text, bigint, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.subscription_is_parents(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.assert_subscription_once() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.apply_wish_trigger(uuid, uuid, boolean, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.attest_wish_trigger(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.dismiss_wish_trigger(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.wish_digest(text, uuid, integer, text, date, text, jsonb) TO kin_app, kin_service;
GRANT EXECUTE ON FUNCTION kin_private.store_wish_recording(uuid, bytea) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.record_wish(uuid, jsonb) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.confirm_wish(uuid, uuid, public.approval_method) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.witness_wish(uuid, uuid) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.withdraw_wish(uuid, uuid) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.add_parent_subscription(uuid, text, bigint, text, jsonb) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.subscription_is_parents(uuid, jsonb) TO kin_service;
GRANT EXECUTE ON FUNCTION kin_private.attest_wish_trigger(uuid, text, text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.dismiss_wish_trigger(uuid, uuid) TO kin_app;

-- A member her wishes favour (the successor a wish names, or the caregiver a
-- keep-paying wish protects) may not report a trigger at all. Their word never
-- counted towards starting one, but an open report freezes her wishes, so a
-- report alone let them hold her wishes still. Replaces the function from 0059.
CREATE OR REPLACE FUNCTION kin_private.attest_wish_trigger(p_circle uuid, p_event text, p_stance text) RETURNS jsonb
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
      -- Someone whose word cannot start it may not open a report either: an open report freezes her
      -- wishes, so the successor a wish names or the caregiver one keeps paid could otherwise hold them.
      IF EXISTS (
        SELECT 1 FROM public.wishes w
        WHERE w.circle_id = p_circle AND w.state = 'in_force' AND w.trigger IN (coalesce(v_trigger.event, p_event), 'either')
          AND ((w.rule_kind = 'successor' AND (w.rule ->> 'memberId')::uuid = v_me)
            OR (w.rule_kind = 'keep_paying' AND EXISTS (
              SELECT 1 FROM public.payees p WHERE p.circle_id = w.circle_id AND p.id = (w.rule ->> 'payeeId')::uuid AND p.member_id = v_me)))
      ) THEN
        RAISE EXCEPTION 'kin: your word cannot start this, because her wishes favour you' USING ERRCODE = 'KW010';
      END IF;
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

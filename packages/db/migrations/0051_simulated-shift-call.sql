-- Kin's call to the parent about a visit, answered in a demo circle.
--
-- A demo circle never places a real call: whoever stands in for the parent
-- hears Kin's sentences on the screen and presses a key. The key is answered
-- here as the real call answers it (record_family_word_by_call, 0037): a yes
-- is the parent's word, given by the parent, and a no is a call she declined;
-- either is a call on the shift's record, at most two to a visit as for a real
-- one. The word is never the person who pressed the key, who only played her
-- part. A real circle is refused: it gets the real call.

CREATE FUNCTION kin_private.answer_simulated_shift_call(p_circle uuid, p_shift uuid, p_answer text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_role public.circle_role := kin_private.my_role(p_circle);
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_shift public.shifts;
    v_parent uuid;
    v_attempt integer;
    v_call uuid := gen_random_uuid();
    v_sid text := 'SIM' || replace(gen_random_uuid()::text, '-', '');
    v_now timestamptz;
  BEGIN
    IF v_role IS NULL OR v_me IS NULL OR v_role NOT IN ('parent', 'organizer', 'contributor') THEN
      RAISE EXCEPTION 'kin: answering the call refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_answer IS NULL OR p_answer NOT IN ('yes', 'no') THEN
      RAISE EXCEPTION 'kin: the answer is not valid' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    SELECT * INTO v_shift FROM public.shifts WHERE circle_id = p_circle AND id = p_shift FOR UPDATE;
    IF v_circle.id IS NULL OR v_shift.id IS NULL OR NOT v_circle.demo THEN
      RAISE EXCEPTION 'kin: answering the call refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_shift.member_id = v_me THEN
      RAISE EXCEPTION 'kin: nobody confirms their own shift' USING ERRCODE = 'KS005';
    END IF;
    -- Kin calls once the visit has ended and before anyone's word is in.
    IF v_shift.kind <> 'aide' OR v_shift.state <> 'checked_out' OR v_shift.family_confirmed_at IS NOT NULL THEN
      RAISE EXCEPTION 'kin: the shift is not waiting for her word' USING ERRCODE = 'KS002';
    END IF;
    SELECT id INTO v_parent FROM public.members WHERE circle_id = p_circle AND role = 'parent' AND status = 'active' ORDER BY joined_at, id LIMIT 1;
    IF v_parent IS NULL THEN
      RAISE EXCEPTION 'kin: the circle has no parent to call' USING ERRCODE = 'KM002';
    END IF;
    SELECT coalesce(max(attempt), 0) + 1 INTO v_attempt FROM public.shift_calls WHERE circle_id = p_circle AND shift_id = p_shift;
    IF v_attempt > 2 THEN
      RAISE EXCEPTION 'kin: Kin calls at most twice for a visit' USING ERRCODE = 'KS002';
    END IF;
    v_now := date_trunc('second', coalesce(v_circle.clock_at, now()));

    INSERT INTO public.shift_calls (id, circle_id, shift_id, attempt, state, call_sid, ended_at)
      VALUES (v_call, p_circle, p_shift, v_attempt, CASE WHEN p_answer = 'yes' THEN 'confirmed' ELSE 'declined' END, v_sid, v_now);
    IF p_answer = 'no' THEN
      INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
        VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'shift.word_declined_by_call', 'shift', p_shift,
                jsonb_build_object('callId', v_call, 'simulated', true, 'parentMemberId', v_parent), 'web');
      RETURN jsonb_build_object('outcome', 'declined');
    END IF;
    UPDATE public.shifts
      SET family_confirmed_by = v_parent, family_confirmed_at = v_now, family_confirmation = 'parent', family_evidence_ref = v_sid, state = 'confirmed'
      WHERE circle_id = p_circle AND id = p_shift;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'shift.word_by_call', 'shift', p_shift,
              jsonb_build_object('callId', v_call, 'simulated', true, 'parentMemberId', v_parent), 'web');
    RETURN jsonb_build_object('outcome', 'confirmed');
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION kin_private.answer_simulated_shift_call(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.answer_simulated_shift_call(uuid, uuid, text) TO kin_app;

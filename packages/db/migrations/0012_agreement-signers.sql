ALTER TABLE "agreements" ADD COLUMN "requires" uuid[];
--> statement-breakpoint

-- A version governs once every member it asks has accepted it: those fixed
-- in `requires` when it was proposed, or, for versions written before that
-- was recorded, its share holders. Mirrors agreementStanding in
-- packages/domain.
CREATE OR REPLACE FUNCTION kin_private.agreement_in_force(p_circle uuid) RETURNS SETOF public.agreements
  LANGUAGE sql STABLE SET search_path = pg_catalog, public
  AS $$
    SELECT a.* FROM public.agreements a
    JOIN public.circles c ON c.id = a.circle_id
    WHERE a.circle_id = p_circle
      AND a.effective_on <= (coalesce(c.clock_at, now()) AT TIME ZONE c.timezone)::date
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(a.requires, ARRAY(SELECT s.member_id FROM public.agreement_shares s WHERE s.agreement_id = a.id))) AS required(member_id)
        WHERE NOT EXISTS (SELECT 1 FROM public.agreement_acceptances x WHERE x.agreement_id = a.id AND x.member_id = required.member_id)
      )
    ORDER BY a.version DESC
    LIMIT 1
  $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION kin_private.propose_agreement(
  p_circle uuid, p_effective_on date, p_care_rate bigint, p_care_cash boolean,
  p_ceiling bigint, p_second bigint, p_parent bigint, p_shares jsonb
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_circle public.circles;
    v_me uuid;
    v_now timestamptz;
    v_version integer;
    v_id uuid := gen_random_uuid();
    v_share jsonb;
    v_position integer := 0;
    v_total bigint := 0;
    v_requires uuid[];
  BEGIN
    IF NOT coalesce(kin_private.is_organizer(p_circle), false) THEN
      RAISE EXCEPTION 'kin: agreement proposal refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active' FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: agreement proposal refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_me := kin_private.my_member_id(p_circle);
    v_now := coalesce(v_circle.clock_at, now());
    IF p_effective_on IS NULL OR p_effective_on < (v_now AT TIME ZONE v_circle.timezone)::date
       OR p_ceiling IS NULL OR p_ceiling <= 0 OR p_ceiling > 9007199254740991
       OR p_second IS NULL OR p_second < 0 OR p_second > p_ceiling
       OR p_parent IS NULL OR p_parent < 0 OR p_parent > p_ceiling
       OR (p_care_rate IS NOT NULL AND (p_care_rate <= 0 OR p_care_rate > 9007199254740991))
       OR p_care_cash IS NULL OR (p_care_cash AND p_care_rate IS NULL)
       OR jsonb_typeof(p_shares) IS DISTINCT FROM 'array' OR jsonb_array_length(p_shares) = 0 THEN
      RAISE EXCEPTION 'kin: invalid agreement terms' USING ERRCODE = 'check_violation';
    END IF;
    FOR v_share IN SELECT value FROM jsonb_array_elements(p_shares) LOOP
      IF jsonb_typeof(v_share) IS DISTINCT FROM 'object' OR v_share - ARRAY['memberId', 'bps'] <> '{}'::jsonb
         OR jsonb_typeof(v_share -> 'bps') IS DISTINCT FROM 'number' OR (v_share ->> 'bps') !~ '^[0-9]{1,5}$'
         OR (v_share ->> 'bps')::integer NOT BETWEEN 1 AND 10000
         OR (v_share ->> 'memberId') !~ '^[0-9a-f-]{36}$'
         OR NOT EXISTS (
           SELECT 1 FROM public.members WHERE circle_id = p_circle AND id = (v_share ->> 'memberId')::uuid
             AND status = 'active' AND role IN ('organizer', 'contributor')
         ) THEN
        RAISE EXCEPTION 'kin: invalid agreement share' USING ERRCODE = 'check_violation';
      END IF;
      v_total := v_total + (v_share ->> 'bps')::integer;
    END LOOP;
    IF v_total <> 10000 OR (SELECT count(DISTINCT value ->> 'memberId') FROM jsonb_array_elements(p_shares)) <> jsonb_array_length(p_shares) THEN
      RAISE EXCEPTION 'kin: invalid agreement shares' USING ERRCODE = 'check_violation';
    END IF;

    -- Everyone whose consent the rules rest on, fixed now: every organizer and
    -- contributor, whether or not the new version gives them a share, and a
    -- parent who decides and can sign in. Nobody can write themselves the
    -- only share and so be the only one asked.
    SELECT array_agg(id ORDER BY joined_at, id) INTO v_requires FROM public.members
      WHERE circle_id = p_circle AND status = 'active'
        AND (role IN ('organizer', 'contributor') OR (role = 'parent' AND parent_level = 'decides' AND user_id IS NOT NULL));
    SELECT coalesce(max(version), 0) + 1 INTO v_version FROM public.agreements WHERE circle_id = p_circle;
    INSERT INTO public.agreements (id, circle_id, version, care_rate_cents_per_hour, care_paid_in_cash, ceiling_cents, second_approval_above_cents, parent_decides_above_cents, effective_on, requires)
      VALUES (v_id, p_circle, v_version, p_care_rate, p_care_cash, p_ceiling, p_second, p_parent, p_effective_on, v_requires);
    FOR v_share IN SELECT value FROM jsonb_array_elements(p_shares) LOOP
      INSERT INTO public.agreement_shares (id, circle_id, agreement_id, member_id, bps, position)
        VALUES (gen_random_uuid(), p_circle, v_id, (v_share ->> 'memberId')::uuid, (v_share ->> 'bps')::integer, v_position);
      v_position := v_position + 1;
    END LOOP;
    INSERT INTO public.agreement_acceptances (id, circle_id, agreement_id, member_id, method, accepted_at)
      VALUES (gen_random_uuid(), p_circle, v_id, v_me, 'app', v_now);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'agreement.proposed', 'agreement', v_id, jsonb_build_object('version', v_version), 'web');
    RETURN v_id;
  END
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.agreement_in_force(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.propose_agreement(uuid, date, bigint, boolean, bigint, bigint, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.agreement_in_force(uuid) TO kin_app, kin_service;
GRANT EXECUTE ON FUNCTION kin_private.propose_agreement(uuid, date, bigint, boolean, bigint, bigint, bigint, jsonb) TO kin_app;

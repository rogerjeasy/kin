-- These operations grant only caregiver setup and own-bill submission. They
-- never grant the web identity direct writes to payees, bills or money records.
CREATE FUNCTION kin_private.configure_caregiver(
  p_circle uuid, p_member uuid, p_payee uuid, p_name text, p_rate bigint
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_payee uuid;
    v_count integer;
  BEGIN
    IF NOT coalesce(kin_private.is_organizer(p_circle), false) THEN
      RAISE EXCEPTION 'kin: caregiver setup refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM 1 FROM public.members WHERE circle_id = p_circle AND id = p_member AND role = 'caregiver' AND status = 'active' FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: caregiver setup refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_rate IS NULL OR p_rate <= 0 OR p_rate > 9007199254740991 OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'kin: invalid caregiver rate' USING ERRCODE = 'check_violation';
    END IF;
    SELECT id INTO v_payee FROM public.payees WHERE circle_id = p_circle AND member_id = p_member AND caregiver_rate_cents_per_hour IS NOT NULL FOR UPDATE;
    IF p_payee IS NOT NULL AND (v_payee IS NOT NULL AND v_payee <> p_payee OR NOT EXISTS (
      SELECT 1 FROM public.payees WHERE circle_id = p_circle AND id = p_payee AND member_id = p_member
    )) THEN
      RAISE EXCEPTION 'kin: caregiver payee refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_payee IS NULL THEN
      v_payee := p_payee;
      IF v_payee IS NULL THEN
        SELECT count(*), (array_agg(id))[1] INTO v_count, v_payee FROM public.payees WHERE circle_id = p_circle AND member_id = p_member;
        IF v_count > 1 THEN
          RAISE EXCEPTION 'kin: select one caregiver payee' USING ERRCODE = 'check_violation';
        END IF;
      END IF;
    END IF;
    IF v_payee IS NULL THEN
      v_payee := gen_random_uuid();
      INSERT INTO public.payees (id, circle_id, name, category, member_id, caregiver_rate_cents_per_hour)
        VALUES (v_payee, p_circle, trim(p_name), 'caregiver', p_member, p_rate);
    ELSE
      UPDATE public.payees SET name = trim(p_name), caregiver_rate_cents_per_hour = p_rate WHERE id = v_payee AND circle_id = p_circle;
    END IF;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', kin_private.my_member_id(p_circle), 'caregiver_rate.configured', 'payee', v_payee, jsonb_build_object('rateCentsPerHour', p_rate), 'web');
    RETURN v_payee;
  END
  $$;
--> statement-breakpoint

CREATE FUNCTION kin_private.submit_caregiver_bill(
  p_circle uuid, p_key uuid, p_details jsonb, p_amount bigint
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_member uuid;
    v_payee public.payees;
    v_previous public.bills;
    v_circle public.circles;
    v_visit jsonb;
    v_date date;
    v_today date;
    v_expected numeric := 0;
    v_duplicate uuid;
    v_id uuid := gen_random_uuid();
  BEGIN
    IF kin_private.my_role(p_circle) IS DISTINCT FROM 'caregiver' THEN
      RAISE EXCEPTION 'kin: caregiver submission refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_member := kin_private.my_member_id(p_circle);
    -- Setup and submission share the member lock, then the payee lock.
    PERFORM 1 FROM public.members WHERE id = v_member AND circle_id = p_circle FOR UPDATE;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: caregiver submission refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_payee FROM public.payees WHERE circle_id = p_circle AND member_id = v_member AND caregiver_rate_cents_per_hour IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: no caregiver rate' USING ERRCODE = 'KB001';
    END IF;
    IF p_key IS NULL THEN
      RAISE EXCEPTION 'kin: missing submission key' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_previous FROM public.bills WHERE circle_id = p_circle AND submission_key = p_key;
    IF FOUND THEN
      IF v_previous.payee_id <> v_payee.id THEN
        RAISE EXCEPTION 'kin: caregiver submission refused' USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF v_previous.caregiver_details IS DISTINCT FROM p_details OR v_previous.amount_cents IS DISTINCT FROM p_amount THEN
        RAISE EXCEPTION 'kin: submission key reused' USING ERRCODE = 'KB004';
      END IF;
      RETURN v_previous.id;
    END IF;
    IF jsonb_typeof(p_details) IS DISTINCT FROM 'object'
       OR p_details - ARRAY['version', 'currency', 'rateCentsPerHour', 'visits'] <> '{}'::jsonb
       OR p_details -> 'version' IS DISTINCT FROM '1'::jsonb
       OR p_details ->> 'currency' IS DISTINCT FROM v_circle.currency
       OR jsonb_typeof(p_details -> 'rateCentsPerHour') IS DISTINCT FROM 'number'
       OR jsonb_typeof(p_details -> 'visits') IS DISTINCT FROM 'array'
       OR p_amount IS NULL OR p_amount NOT BETWEEN 1 AND 9007199254740991 THEN
      RAISE EXCEPTION 'kin: invalid caregiver bill' USING ERRCODE = 'check_violation';
    END IF;
    IF p_details ->> 'rateCentsPerHour' IS DISTINCT FROM v_payee.caregiver_rate_cents_per_hour::text THEN
      RAISE EXCEPTION 'kin: caregiver rate changed' USING ERRCODE = 'KB002';
    END IF;
    IF jsonb_array_length(p_details -> 'visits') = 0 THEN
      RAISE EXCEPTION 'kin: empty caregiver bill' USING ERRCODE = 'check_violation';
    END IF;
    v_today := (coalesce(v_circle.clock_at, now()) AT TIME ZONE v_circle.timezone)::date;
    FOR v_visit IN SELECT value FROM jsonb_array_elements(p_details -> 'visits') LOOP
      IF jsonb_typeof(v_visit) IS DISTINCT FROM 'object'
         OR v_visit - ARRAY['date', 'minutes'] <> '{}'::jsonb
         OR jsonb_typeof(v_visit -> 'date') IS DISTINCT FROM 'string'
         OR (v_visit ->> 'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         OR jsonb_typeof(v_visit -> 'minutes') IS DISTINCT FROM 'number'
         OR (v_visit ->> 'minutes') !~ '^[0-9]{1,4}$' THEN
        RAISE EXCEPTION 'kin: invalid caregiver visit' USING ERRCODE = 'check_violation';
      END IF;
      v_date := (v_visit ->> 'date')::date;
      IF v_date > v_today OR v_date < '0001-01-01'::date OR (v_visit ->> 'minutes')::integer NOT BETWEEN 1 AND 1440 THEN
        RAISE EXCEPTION 'kin: invalid caregiver visit' USING ERRCODE = 'check_violation';
      END IF;
      -- An integrity assertion, matching the domain's integer half-up care
      -- valuation. A direct caller cannot store a total that contradicts the
      -- immutable evidence and thereby make the circle unreadable.
      v_expected := v_expected + floor(((v_visit ->> 'minutes')::numeric * v_payee.caregiver_rate_cents_per_hour + 30) / 60);
      SELECT b.id INTO v_duplicate FROM public.bills b, LATERAL jsonb_array_elements(b.caregiver_details -> 'visits') old_visit
        WHERE b.circle_id = p_circle AND b.payee_id = v_payee.id AND b.state <> 'rejected' AND old_visit ->> 'date' = v_visit ->> 'date'
        ORDER BY b.created_at, b.id LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION 'kin: service day already billed' USING ERRCODE = 'KB003', DETAIL = v_duplicate::text;
      END IF;
    END LOOP;
    IF v_expected <> p_amount THEN
      RAISE EXCEPTION 'kin: bill amount contradicts its evidence' USING ERRCODE = 'check_violation';
    END IF;
    IF (SELECT count(*) <> count(DISTINCT value ->> 'date') FROM jsonb_array_elements(p_details -> 'visits')) THEN
      RAISE EXCEPTION 'kin: repeated service day' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.bills (id, circle_id, payee_id, amount_cents, received_on, caregiver_details, submission_key)
      VALUES (v_id, p_circle, v_payee.id, p_amount, v_today, p_details, p_key);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_member, 'caregiver_bill.submitted', 'bill', v_id, 'web');
    RETURN v_id;
  END
  $$;
--> statement-breakpoint

CREATE FUNCTION kin_private.preserve_caregiver_bill() RETURNS trigger
  LANGUAGE plpgsql AS $$
  BEGIN
    IF OLD.caregiver_details IS NOT NULL AND (
      NEW.caregiver_details IS DISTINCT FROM OLD.caregiver_details OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
      OR NEW.circle_id IS DISTINCT FROM OLD.circle_id OR NEW.payee_id IS DISTINCT FROM OLD.payee_id
      OR NEW.submission_key IS DISTINCT FROM OLD.submission_key OR NEW.received_on IS DISTINCT FROM OLD.received_on
    ) THEN
      RAISE EXCEPTION 'kin: submitted caregiver evidence is immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER preserve_caregiver_bill BEFORE UPDATE ON public.bills FOR EACH ROW EXECUTE FUNCTION kin_private.preserve_caregiver_bill();

REVOKE ALL ON FUNCTION kin_private.configure_caregiver(uuid, uuid, uuid, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.submit_caregiver_bill(uuid, uuid, jsonb, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.preserve_caregiver_bill() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.configure_caregiver(uuid, uuid, uuid, text, bigint) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.submit_caregiver_bill(uuid, uuid, jsonb, bigint) TO kin_app;

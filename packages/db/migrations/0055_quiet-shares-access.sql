-- Quiet shares: who may see an ask, a sealed offer and a part, and the
-- operations that write them. Tables quiet_share_asks, sealed_offers and
-- quiet_share_parts and their checks come from the generated migration before
-- this one.
--
-- The promise is that nobody has to say out loud what they cannot afford. So a
-- sealed offer is read by its author alone (not the organizer, not an
-- observer, not Kin's service), and a part by its own person alone. The
-- mediator below runs as the database's owner, reads every offer of one ask,
-- and writes only parts and the family's total and shortfall. It is the same
-- algorithm as mediateQuietShare in packages/domain (quiet-share.ts); a test
-- runs both over random asks and holds them to the same answers.
--
-- Refusals that screens word, by SQLSTATE:
--   42501  the person may not do this, or the ask is not theirs to answer
--   23514  the offer or the ask is not one Kin can hold
--   KQ001  the ask is not in a state that allows this
--   KQ002  the person has sealed their offer as many times as Kin allows
ALTER TABLE public.quiet_share_asks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sealed_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiet_share_parts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- An ask is as visible as the circle's money. The service reads it for the circle it acts for.
CREATE POLICY service_own_circle ON public.quiet_share_asks FOR SELECT TO kin_service
  USING (circle_id = kin_private.circle_id());
CREATE POLICY provisioner_new_circle ON public.quiet_share_asks FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
CREATE POLICY app_member_read ON public.quiet_share_asks FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));

-- An offer and a part are their own person's. Kin's service holds a policy that
-- shows it nothing, so no job can read a limit either.
CREATE POLICY service_reads_nothing ON public.sealed_offers FOR SELECT TO kin_service USING (false);
CREATE POLICY provisioner_new_circle ON public.sealed_offers FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
CREATE POLICY app_author_read ON public.sealed_offers FOR SELECT TO kin_app
  USING (member_id = kin_private.my_member_id(circle_id));
CREATE POLICY service_reads_nothing ON public.quiet_share_parts FOR SELECT TO kin_service USING (false);
CREATE POLICY app_own_part_read ON public.quiet_share_parts FOR SELECT TO kin_app
  USING (member_id = kin_private.my_member_id(circle_id));
--> statement-breakpoint

-- Only the operations below write. The provisioner seeds a demo's waiting ask
-- and the organizer's own offer on it.
GRANT SELECT ON public.quiet_share_asks, public.sealed_offers, public.quiet_share_parts TO kin_app, kin_service;
GRANT INSERT ON public.quiet_share_asks, public.sealed_offers TO kin_provisioner;
--> statement-breakpoint

INSERT INTO kin_private.state_transitions (machine, from_state, to_state) VALUES
  ('quiet_share', 'gathering', 'planned'),
  ('quiet_share', 'gathering', 'short'),
  ('quiet_share', 'gathering', 'withdrawn'),
  ('quiet_share', 'short', 'planned'),
  ('quiet_share', 'short', 'withdrawn'),
  ('quiet_share', 'planned', 'agreed'),
  ('quiet_share', 'planned', 'withdrawn');

CREATE TRIGGER state_moves_forward BEFORE UPDATE OF state ON public.quiet_share_asks
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_transition('quiet_share');
--> statement-breakpoint

-- Nothing here is ever deleted.
CREATE TRIGGER no_delete BEFORE DELETE ON public.quiet_share_asks FOR EACH ROW EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER no_delete_truncate BEFORE TRUNCATE ON public.quiet_share_asks FOR EACH STATEMENT EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER no_delete BEFORE DELETE ON public.sealed_offers FOR EACH ROW EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER no_delete_truncate BEFORE TRUNCATE ON public.sealed_offers FOR EACH STATEMENT EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER no_delete BEFORE DELETE ON public.quiet_share_parts FOR EACH ROW EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER no_delete_truncate BEFORE TRUNCATE ON public.quiet_share_parts FOR EACH STATEMENT EXECUTE FUNCTION kin_private.refuse_change();
--> statement-breakpoint

-- What an ask covers never changes after it is raised; its progress does.
CREATE FUNCTION kin_private.assert_quiet_share_fixed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF (to_jsonb(NEW) - ARRAY['state', 'round', 'months', 'answered_count', 'part_count', 'accepted_count', 'shortfall_cents', 'spread_would_cover', 'pay_later_used', 'decided_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state', 'round', 'months', 'answered_count', 'part_count', 'accepted_count', 'shortfall_cents', 'spread_would_cover', 'pay_later_used', 'decided_at']) THEN
      RAISE EXCEPTION 'kin: quiet share % cannot change what it covers', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.round < OLD.round OR NEW.months < OLD.months THEN
      RAISE EXCEPTION 'kin: quiet share % only moves forward', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER terms_fixed BEFORE UPDATE ON public.quiet_share_asks FOR EACH ROW EXECUTE FUNCTION kin_private.assert_quiet_share_fixed();

-- A part's figures are the mediator's and never change; the person's yes, how they pay and what was prepared are set once.
CREATE FUNCTION kin_private.assert_quiet_part_fixed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF (to_jsonb(NEW) - ARRAY['accepted_at', 'method', 'prepared_at', 'paypal_ref', 'approval_url'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['accepted_at', 'method', 'prepared_at', 'paypal_ref', 'approval_url'])
       OR (OLD.accepted_at IS NOT NULL AND (NEW.accepted_at IS DISTINCT FROM OLD.accepted_at OR NEW.method IS DISTINCT FROM OLD.method))
       OR (OLD.prepared_at IS NOT NULL AND NEW.prepared_at IS DISTINCT FROM OLD.prepared_at)
       OR (OLD.paypal_ref IS NOT NULL AND NEW.paypal_ref IS DISTINCT FROM OLD.paypal_ref) THEN
      RAISE EXCEPTION 'kin: quiet share part % cannot change', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER figures_fixed BEFORE UPDATE ON public.quiet_share_parts FOR EACH ROW EXECUTE FUNCTION kin_private.assert_quiet_part_fixed();
--> statement-breakpoint

-- Shares `p_total` out in proportion to `p_weights` by the largest-remainder
-- method, ties to the earlier weight: allocate() in packages/domain.
CREATE FUNCTION kin_private.allocate_cents(p_total bigint, p_weights bigint[]) RETURNS bigint[]
  LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog
  AS $$
  DECLARE
    v_n integer := coalesce(cardinality(p_weights), 0);
    v_sum numeric := 0;
    v_whole bigint[] := '{}';
    v_rem numeric[] := '{}';
    v_order integer[];
    v_left bigint;
    i integer;
  BEGIN
    IF p_total < 0 THEN
      RAISE EXCEPTION 'kin: cannot share out a negative total' USING ERRCODE = 'check_violation';
    END IF;
    FOR i IN 1..v_n LOOP
      IF p_weights[i] IS NULL OR p_weights[i] < 0 THEN
        RAISE EXCEPTION 'kin: a weight must be zero or more' USING ERRCODE = 'check_violation';
      END IF;
      v_sum := v_sum + p_weights[i];
    END LOOP;
    IF v_sum = 0 THEN
      RAISE EXCEPTION 'kin: at least one weight must be above zero' USING ERRCODE = 'check_violation';
    END IF;
    FOR i IN 1..v_n LOOP
      v_whole[i] := div(p_total::numeric * p_weights[i], v_sum)::bigint;
      v_rem[i] := mod(p_total::numeric * p_weights[i], v_sum);
    END LOOP;
    v_left := p_total - (SELECT sum(w) FROM unnest(v_whole) AS w);
    SELECT array_agg(idx ORDER BY rem DESC, idx) INTO v_order FROM unnest(v_rem) WITH ORDINALITY AS t(rem, idx);
    FOR i IN 1..v_left LOOP
      v_whole[v_order[i]] := v_whole[v_order[i]] + 1;
    END LOOP;
    RETURN v_whole;
  END
  $$;

-- What an offer gives in one month: nothing before its first month, the step-up from its month on. offerInMonth().
CREATE FUNCTION kin_private.offer_in_month(p_offer jsonb, p_month text) RETURNS bigint
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
  AS $$
    SELECT CASE
      WHEN p_offer ->> 'earliestMonth' IS NOT NULL AND p_month COLLATE "C" < (p_offer ->> 'earliestMonth') COLLATE "C" THEN 0::bigint
      WHEN p_offer ->> 'stepUpFrom' IS NOT NULL AND p_month COLLATE "C" >= (p_offer ->> 'stepUpFrom') COLLATE "C" THEN (p_offer ->> 'stepUpCents')::bigint
      ELSE (p_offer ->> 'monthlyCents')::bigint
    END
  $$;

-- The mediator: mediateQuietShare() in packages/domain, step for step. `p_rows`
-- holds one object per person asked: memberId, bps, monthlyCents, stepUpCents,
-- stepUpFrom, careTrips, careMinutes, earliestMonth, takesShortfall. People are
-- taken in member-ID order (byte order, as JavaScript compares strings).
CREATE FUNCTION kin_private.mediate_offers(p_cost bigint, p_start text, p_months integer, p_rate bigint, p_rows jsonb) RETURNS jsonb
  LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog
  AS $$
  DECLARE
    v_rows jsonb[];
    v_n integer;
    v_months text[];
    v_bps bigint[] := '{}';
    v_cap bigint[] := '{}';
    v_part bigint[] := '{}';
    v_later bigint[] := '{}';
    v_open integer[];
    v_takers integer[];
    v_weights bigint[];
    v_given bigint[];
    v_targets bigint[];
    v_caps bigint[];
    v_spread bigint[];
    v_remaining bigint := p_cost;
    v_placed bigint;
    v_take bigint;
    v_minutes integer;
    v_parts jsonb := '[]'::jsonb;
    i integer;
    pos integer;
  BEGIN
    SELECT array_agg(r ORDER BY (r ->> 'memberId') COLLATE "C") INTO v_rows FROM jsonb_array_elements(p_rows) AS r;
    v_n := coalesce(cardinality(v_rows), 0);
    IF v_n = 0 OR p_cost <= 0 OR p_months < 1 THEN
      RAISE EXCEPTION 'kin: nothing to mediate' USING ERRCODE = 'check_violation';
    END IF;
    SELECT array_agg(to_char(make_date(substr(p_start, 1, 4)::integer, substr(p_start, 6, 2)::integer, 1) + make_interval(months => k), 'YYYY-MM') ORDER BY k)
      INTO v_months FROM generate_series(0, p_months - 1) AS k;
    FOR i IN 1..v_n LOOP
      v_bps[i] := (v_rows[i] ->> 'bps')::bigint;
      v_cap[i] := (SELECT sum(kin_private.offer_in_month(v_rows[i], m)) FROM unnest(v_months) AS m);
      v_part[i] := 0;
      v_later[i] := 0;
    END LOOP;

    -- By the agreed shares, capped at each offer; what the caps leave goes to those with room, round after round.
    SELECT coalesce(array_agg(g.n ORDER BY g.n), '{}') INTO v_open FROM generate_series(1, v_n) AS g(n) WHERE v_cap[g.n] > 0;
    WHILE v_remaining > 0 AND cardinality(v_open) > 0 LOOP
      SELECT array_agg(v_bps[o] ORDER BY ord) INTO v_weights FROM unnest(v_open) WITH ORDINALITY AS u(o, ord);
      v_given := kin_private.allocate_cents(v_remaining, v_weights);
      v_placed := 0;
      FOR pos IN 1..cardinality(v_open) LOOP
        i := v_open[pos];
        v_take := least(v_given[pos], v_cap[i] - v_part[i]);
        v_part[i] := v_part[i] + v_take;
        v_placed := v_placed + v_take;
      END LOOP;
      v_remaining := v_remaining - v_placed;
      SELECT coalesce(array_agg(o ORDER BY ord), '{}') INTO v_open FROM unnest(v_open) WITH ORDINALITY AS u(o, ord) WHERE v_part[o] < v_cap[o];
    END LOOP;

    -- A gap goes to whoever took it on with Pay Later, by their shares.
    SELECT coalesce(array_agg(g.n ORDER BY g.n), '{}') INTO v_takers FROM generate_series(1, v_n) AS g(n) WHERE (v_rows[g.n] ->> 'takesShortfall')::boolean;
    IF v_remaining > 0 AND cardinality(v_takers) > 0 THEN
      SELECT array_agg(v_bps[o] ORDER BY ord) INTO v_weights FROM unnest(v_takers) WITH ORDINALITY AS u(o, ord);
      v_given := kin_private.allocate_cents(v_remaining, v_weights);
      FOR pos IN 1..cardinality(v_takers) LOOP
        v_later[v_takers[pos]] := v_given[pos];
      END LOOP;
      v_remaining := 0;
    END IF;

    v_targets := kin_private.allocate_cents(p_cost, v_bps);
    FOR i IN 1..v_n LOOP
      SELECT array_agg(kin_private.offer_in_month(v_rows[i], m) ORDER BY ord) INTO v_caps FROM unnest(v_months) WITH ORDINALITY AS u(m, ord);
      IF EXISTS (SELECT 1 FROM unnest(v_caps) AS c WHERE c > 0) THEN
        v_spread := kin_private.allocate_cents(v_part[i], v_caps);
      ELSE
        v_spread := array_fill(0::bigint, ARRAY[p_months]);
      END IF;
      v_spread[1] := v_spread[1] + v_later[i];
      v_minutes := (v_rows[i] ->> 'careMinutes')::integer;
      v_parts := v_parts || jsonb_build_object(
        'memberId', v_rows[i] ->> 'memberId',
        'cents', v_part[i] + v_later[i],
        'perMonth', to_jsonb(v_spread),
        'payLaterCents', v_later[i],
        'atLimit', v_part[i] = v_cap[i] AND v_part[i] < v_targets[i],
        'shareCents', v_targets[i],
        'careTrips', (v_rows[i] ->> 'careTrips')::integer,
        'careMinutes', v_minutes,
        'careValueCents', CASE WHEN v_minutes > 0 AND p_rate IS NOT NULL THEN (v_minutes::bigint * p_rate + 30) / 60 ELSE 0 END
      );
    END LOOP;
    RETURN jsonb_build_object('parts', v_parts, 'coveredCents', p_cost - v_remaining, 'shortfallCents', v_remaining);
  END
  $$;
--> statement-breakpoint

-- Runs the mediator on an ask whose offers are all in, and writes the plan:
-- a new round of parts, the family's shortfall, and whether spreading it would
-- cover it. Nothing about any one person's offer leaves this function.
CREATE FUNCTION kin_private.mediate_quiet_share(p_circle uuid, p_ask uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_ask public.quiet_share_asks;
    v_rate bigint;
    v_rows jsonb;
    v_result jsonb;
    v_part jsonb;
    v_round integer;
    v_shortfall bigint;
    v_needed integer := 0;
    v_spread boolean := NULL;
    v_state text;
  BEGIN
    SELECT * INTO v_ask FROM public.quiet_share_asks WHERE circle_id = p_circle AND id = p_ask FOR UPDATE;
    SELECT care_rate_cents_per_hour INTO v_rate FROM public.agreements WHERE circle_id = p_circle AND id = v_ask.agreement_id;
    SELECT jsonb_agg(jsonb_build_object(
             'memberId', o.member_id::text, 'bps', s.bps, 'monthlyCents', o.monthly_cents, 'stepUpCents', o.step_up_cents, 'stepUpFrom', o.step_up_from,
             'careTrips', o.care_trips, 'careMinutes', o.care_minutes, 'earliestMonth', o.earliest_month, 'takesShortfall', o.takes_shortfall))
      INTO v_rows
      FROM public.sealed_offers o
      JOIN public.agreement_shares s ON s.circle_id = o.circle_id AND s.agreement_id = v_ask.agreement_id AND s.member_id = o.member_id
      WHERE o.circle_id = p_circle AND o.ask_id = p_ask AND o.member_id = ANY (v_ask.asked);
    IF coalesce(jsonb_array_length(v_rows), 0) <> cardinality(v_ask.asked) THEN
      RAISE EXCEPTION 'kin: quiet share % is still waiting for offers', p_ask USING ERRCODE = 'KQ001';
    END IF;
    v_result := kin_private.mediate_offers(v_ask.cost_cents, v_ask.start_month, v_ask.months, v_rate, v_rows);
    v_shortfall := (v_result ->> 'shortfallCents')::bigint;
    v_round := v_ask.round + 1;
    FOR v_part IN SELECT * FROM jsonb_array_elements(v_result -> 'parts') LOOP
      INSERT INTO public.quiet_share_parts (id, circle_id, ask_id, member_id, round, cents, per_month, pay_later_cents, at_limit, share_cents,
                                            care_trips, care_minutes, care_value_cents, accepted_at, method)
        VALUES (gen_random_uuid(), p_circle, p_ask, (v_part ->> 'memberId')::uuid, v_round, (v_part ->> 'cents')::bigint,
                ARRAY(SELECT e::bigint FROM jsonb_array_elements_text(v_part -> 'perMonth') WITH ORDINALITY AS t(e, n) ORDER BY n), (v_part ->> 'payLaterCents')::bigint, (v_part ->> 'atLimit')::boolean,
                (v_part ->> 'shareCents')::bigint, (v_part ->> 'careTrips')::integer, (v_part ->> 'careMinutes')::integer, (v_part ->> 'careValueCents')::bigint,
                -- A part that asks nothing of its person needs no yes from them.
                CASE WHEN (v_part ->> 'cents')::bigint = 0 AND (v_part ->> 'careMinutes')::integer = 0 AND (v_part ->> 'careTrips')::integer = 0 THEN now() END,
                CASE WHEN (v_part ->> 'cents')::bigint = 0 AND (v_part ->> 'careMinutes')::integer = 0 AND (v_part ->> 'careTrips')::integer = 0 THEN 'checkout' END);
      IF NOT ((v_part ->> 'cents')::bigint = 0 AND (v_part ->> 'careMinutes')::integer = 0 AND (v_part ->> 'careTrips')::integer = 0) THEN
        v_needed := v_needed + 1;
      END IF;
    END LOOP;
    IF v_shortfall > 0 AND v_ask.kind = 'one_off' AND v_ask.months = 1 THEN
      SELECT jsonb_agg(r || '{"takesShortfall": false}'::jsonb) INTO v_rows FROM jsonb_array_elements(v_rows) AS r;
      v_spread := (kin_private.mediate_offers(v_ask.cost_cents, v_ask.start_month, 3, v_rate, v_rows) ->> 'shortfallCents')::bigint = 0;
    END IF;
    v_state := CASE WHEN v_shortfall > 0 THEN 'short' ELSE 'planned' END;
    UPDATE public.quiet_share_asks
      SET state = v_state, round = v_round, part_count = v_needed, accepted_count = 0, shortfall_cents = v_shortfall, spread_would_cover = v_spread,
          pay_later_used = EXISTS (SELECT 1 FROM jsonb_array_elements(v_result -> 'parts') AS p WHERE (p ->> 'payLaterCents')::bigint > 0)
      WHERE circle_id = p_circle AND id = p_ask;
    INSERT INTO public.audit_log (id, circle_id, actor, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'service', 'quiet_share.mediated', 'quiet_share', p_ask,
              jsonb_build_object('round', v_round, 'outcome', v_state, 'shortfallCents', v_shortfall), 'mediator');
    RETURN v_state;
  END
  $$;
--> statement-breakpoint

-- Raises an ask: the organizer, for a cost the pool cannot carry alone. The
-- people asked are those who hold a share in the agreement in force; their
-- shares are the mediator's. Raising the same open ask again returns it.
CREATE FUNCTION kin_private.raise_quiet_share(p_circle uuid, p_title text, p_kind text, p_cost bigint, p_bill uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_circle public.circles;
    v_agreement public.agreements;
    v_asked uuid[];
    v_id uuid := gen_random_uuid();
    v_existing uuid;
    v_title text := btrim(coalesce(p_title, ''));
  BEGIN
    IF kin_private.my_role(p_circle) IS DISTINCT FROM 'organizer' OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: raising a quiet share refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_circle FROM public.circles WHERE id = p_circle AND status = 'active' FOR UPDATE;
    SELECT * INTO v_agreement FROM kin_private.agreement_in_force(p_circle);
    IF v_circle.id IS NULL OR v_agreement.id IS NULL THEN
      RAISE EXCEPTION 'kin: a quiet share needs an agreement in force' USING ERRCODE = 'KQ001';
    END IF;
    SELECT array_agg(s.member_id ORDER BY s.position) INTO v_asked
      FROM public.agreement_shares s JOIN public.members m ON m.circle_id = s.circle_id AND m.id = s.member_id
      WHERE s.circle_id = p_circle AND s.agreement_id = v_agreement.id AND m.status = 'active' AND m.role IN ('organizer', 'contributor');
    IF v_asked IS NULL OR (SELECT sum(bps) FROM public.agreement_shares WHERE agreement_id = v_agreement.id AND member_id = ANY (v_asked)) <> 10000 THEN
      RAISE EXCEPTION 'kin: the agreement in force has no shares to ask' USING ERRCODE = 'KQ001';
    END IF;
    SELECT id INTO v_existing FROM public.quiet_share_asks
      WHERE circle_id = p_circle AND title = v_title AND kind = p_kind AND cost_cents = p_cost AND state IN ('gathering', 'short', 'planned') LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
    INSERT INTO public.quiet_share_asks (id, circle_id, title, kind, cost_cents, bill_id, agreement_id, asked, start_month, simulated, raised_by)
      VALUES (v_id, p_circle, v_title, p_kind, p_cost, p_bill, v_agreement.id, v_asked,
              to_char(coalesce(v_circle.clock_at, now()) AT TIME ZONE v_circle.timezone, 'YYYY-MM'), v_circle.demo, v_me);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'quiet_share.raised', 'quiet_share', v_id, jsonb_build_object('costCents', p_cost, 'kind', p_kind), 'web');
    RETURN v_id;
  END
  $$;
--> statement-breakpoint

-- Seals the person's own offer on an ask that is still open. `p_offer` holds
-- monthlyCents, stepUpCents, stepUpFrom, careTrips, careMinutes and
-- earliestMonth; the checks on the table refuse what is out of range. The
-- record of it says only that the person answered, never what. Once everyone
-- has answered, the mediator runs. Returns where the ask stands.
CREATE FUNCTION kin_private.seal_my_offer(p_circle uuid, p_ask uuid, p_offer jsonb) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_ask public.quiet_share_asks;
    v_existing public.sealed_offers;
    v_key text;
    v_now timestamptz;
    v_answered integer;
  BEGIN
    IF coalesce(kin_private.my_role(p_circle)::text, '') NOT IN ('organizer', 'contributor') OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: sealing an offer refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT a.* INTO v_ask FROM public.quiet_share_asks a JOIN public.circles c ON c.id = a.circle_id AND c.status = 'active'
      WHERE a.circle_id = p_circle AND a.id = p_ask FOR UPDATE OF a;
    IF v_ask.id IS NULL OR NOT (v_me = ANY (v_ask.asked)) THEN
      RAISE EXCEPTION 'kin: sealing an offer refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_ask.state NOT IN ('gathering', 'short') THEN
      RAISE EXCEPTION 'kin: the ask is no longer open for offers' USING ERRCODE = 'KQ001';
    END IF;
    IF jsonb_typeof(p_offer) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'kin: the offer is not an object' USING ERRCODE = 'check_violation';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(p_offer) LOOP
      IF v_key NOT IN ('monthlyCents', 'stepUpCents', 'stepUpFrom', 'careTrips', 'careMinutes', 'earliestMonth') THEN
        RAISE EXCEPTION 'kin: unknown part of an offer %', v_key USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
    IF coalesce(p_offer ->> 'monthlyCents', '') !~ '^[0-9]{1,9}$' OR coalesce(p_offer ->> 'careTrips', '0') !~ '^[0-9]{1,3}$' OR coalesce(p_offer ->> 'careMinutes', '0') !~ '^[0-9]{1,5}$'
       OR coalesce(p_offer ->> 'stepUpCents', '0') !~ '^[0-9]{1,9}$'
       OR (p_offer ->> 'stepUpFrom' IS NOT NULL AND (p_offer ->> 'stepUpFrom') COLLATE "C" <= v_ask.start_month COLLATE "C")
       OR (p_offer ->> 'earliestMonth' IS NOT NULL AND (p_offer ->> 'earliestMonth') COLLATE "C" < v_ask.start_month COLLATE "C") THEN
      RAISE EXCEPTION 'kin: the offer is not one Kin can hold' USING ERRCODE = 'check_violation';
    END IF;
    v_now := date_trunc('second', now());
    SELECT * INTO v_existing FROM public.sealed_offers WHERE circle_id = p_circle AND ask_id = p_ask AND member_id = v_me FOR UPDATE;
    IF v_existing.id IS NULL THEN
      INSERT INTO public.sealed_offers (id, circle_id, ask_id, member_id, monthly_cents, step_up_cents, step_up_from, care_trips, care_minutes, earliest_month, sealed_at)
        VALUES (gen_random_uuid(), p_circle, p_ask, v_me, (p_offer ->> 'monthlyCents')::bigint, (p_offer ->> 'stepUpCents')::bigint, p_offer ->> 'stepUpFrom',
                coalesce((p_offer ->> 'careTrips')::integer, 0), coalesce((p_offer ->> 'careMinutes')::integer, 0), p_offer ->> 'earliestMonth', v_now);
      UPDATE public.quiet_share_asks SET answered_count = answered_count + 1 WHERE circle_id = p_circle AND id = p_ask RETURNING answered_count INTO v_answered;
    ELSE
      IF v_existing.seals >= 3 THEN
        RAISE EXCEPTION 'kin: this offer has been sealed as many times as Kin allows' USING ERRCODE = 'KQ002';
      END IF;
      UPDATE public.sealed_offers
        SET monthly_cents = (p_offer ->> 'monthlyCents')::bigint, step_up_cents = (p_offer ->> 'stepUpCents')::bigint, step_up_from = p_offer ->> 'stepUpFrom',
            care_trips = coalesce((p_offer ->> 'careTrips')::integer, 0), care_minutes = coalesce((p_offer ->> 'careMinutes')::integer, 0),
            earliest_month = p_offer ->> 'earliestMonth', seals = seals + 1, sealed_at = v_now
        WHERE id = v_existing.id;
      v_answered := v_ask.answered_count;
    END IF;
    -- The record says that an offer was sealed, never whose or what: the organizer reads the audit log, and who sealed
    -- again, and when, would hint at who is near their limit. The person's own row holds when they sealed it.
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'service', NULL, 'quiet_share.offer_sealed', 'quiet_share', p_ask, '{}'::jsonb, 'mediator');
    IF v_answered = cardinality(v_ask.asked) THEN
      RETURN kin_private.mediate_quiet_share(p_circle, p_ask);
    END IF;
    RETURN v_ask.state;
  END
  $$;
--> statement-breakpoint

-- A short one-off cost, spread over three months. The organizer chooses it.
CREATE FUNCTION kin_private.spread_quiet_share(p_circle uuid, p_ask uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_ask public.quiet_share_asks;
  BEGIN
    IF kin_private.my_role(p_circle) IS DISTINCT FROM 'organizer' OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: spreading a quiet share refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT a.* INTO v_ask FROM public.quiet_share_asks a JOIN public.circles c ON c.id = a.circle_id AND c.status = 'active'
      WHERE a.circle_id = p_circle AND a.id = p_ask FOR UPDATE OF a;
    IF v_ask.id IS NULL THEN
      RAISE EXCEPTION 'kin: spreading a quiet share refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_ask.state <> 'short' OR v_ask.kind <> 'one_off' OR v_ask.months <> 1 THEN
      RAISE EXCEPTION 'kin: only a short one-off cost is spread' USING ERRCODE = 'KQ001';
    END IF;
    UPDATE public.quiet_share_asks SET months = 3 WHERE circle_id = p_circle AND id = p_ask;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'quiet_share.spread', 'quiet_share', p_ask, jsonb_build_object('months', 3), 'web');
    RETURN kin_private.mediate_quiet_share(p_circle, p_ask);
  END
  $$;

-- A person takes the family's gap on with PayPal Pay Later, privately: their
-- own offer says so, and the plan shows only that someone did.
CREATE FUNCTION kin_private.take_quiet_share_gap(p_circle uuid, p_ask uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_ask public.quiet_share_asks;
  BEGIN
    IF coalesce(kin_private.my_role(p_circle)::text, '') NOT IN ('organizer', 'contributor') OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: taking the gap refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT a.* INTO v_ask FROM public.quiet_share_asks a JOIN public.circles c ON c.id = a.circle_id AND c.status = 'active'
      WHERE a.circle_id = p_circle AND a.id = p_ask FOR UPDATE OF a;
    IF v_ask.id IS NULL OR NOT (v_me = ANY (v_ask.asked)) THEN
      RAISE EXCEPTION 'kin: taking the gap refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_ask.state <> 'short' OR v_ask.kind <> 'one_off' THEN
      RAISE EXCEPTION 'kin: only a short one-off cost has a gap to take' USING ERRCODE = 'KQ001';
    END IF;
    UPDATE public.sealed_offers SET takes_shortfall = true WHERE circle_id = p_circle AND ask_id = p_ask AND member_id = v_me;
    -- Who took the gap on stays in their own offer row alone; the record says only that someone did.
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'service', NULL, 'quiet_share.gap_taken', 'quiet_share', p_ask, '{}'::jsonb, 'mediator');
    RETURN kin_private.mediate_quiet_share(p_circle, p_ask);
  END
  $$;
--> statement-breakpoint

-- The person says yes to their own part and how they will pay it: the ways
-- partMethods() in packages/domain allows. Once every part has its yes the
-- plan is agreed, and each person's PayPal action is prepared: at once for
-- checkout, Pay Later and a demo circle's simulated actions; the web app
-- records PayPal's reference for a monthly share's revision afterwards.
CREATE FUNCTION kin_private.accept_my_quiet_share_part(p_circle uuid, p_ask uuid, p_method text) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_ask public.quiet_share_asks;
    v_part public.quiet_share_parts;
    v_accepted integer;
  BEGIN
    IF coalesce(kin_private.my_role(p_circle)::text, '') NOT IN ('organizer', 'contributor') OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: accepting a part refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT a.* INTO v_ask FROM public.quiet_share_asks a JOIN public.circles c ON c.id = a.circle_id AND c.status = 'active'
      WHERE a.circle_id = p_circle AND a.id = p_ask FOR UPDATE OF a;
    SELECT * INTO v_part FROM public.quiet_share_parts WHERE circle_id = p_circle AND ask_id = p_ask AND round = v_ask.round AND member_id = v_me FOR UPDATE;
    IF v_ask.id IS NULL OR v_part.id IS NULL THEN
      RAISE EXCEPTION 'kin: accepting a part refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_ask.state <> 'planned' THEN
      RAISE EXCEPTION 'kin: the plan is not waiting for yeses' USING ERRCODE = 'KQ001';
    END IF;
    IF v_part.accepted_at IS NOT NULL THEN
      RETURN v_ask.state;
    END IF;
    IF NOT ((v_ask.kind = 'monthly' AND p_method = 'monthly_share')
         OR (v_ask.kind = 'one_off' AND v_part.pay_later_cents > 0 AND p_method = 'pay_later')
         OR (v_ask.kind = 'one_off' AND v_part.pay_later_cents = 0 AND p_method IN ('checkout', 'pay_later', 'invoice'))) THEN
      RAISE EXCEPTION 'kin: that is not a way to pay this part' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.quiet_share_parts SET accepted_at = now(), method = p_method WHERE id = v_part.id;
    UPDATE public.quiet_share_asks SET accepted_count = accepted_count + 1 WHERE circle_id = p_circle AND id = p_ask RETURNING accepted_count INTO v_accepted;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'quiet_share.part_accepted', 'quiet_share', p_ask, '{}'::jsonb, 'web');
    IF v_accepted = v_ask.part_count THEN
      UPDATE public.quiet_share_asks SET state = 'agreed', decided_at = now() WHERE circle_id = p_circle AND id = p_ask;
      UPDATE public.quiet_share_parts SET prepared_at = now()
        WHERE circle_id = p_circle AND ask_id = p_ask AND round = v_ask.round AND prepared_at IS NULL
          AND cents > 0 AND (v_ask.simulated OR method IN ('checkout', 'pay_later'));
      INSERT INTO public.audit_log (id, circle_id, actor, action, subject_type, subject_id, details, origin)
        VALUES (gen_random_uuid(), p_circle, 'service', 'quiet_share.agreed', 'quiet_share', p_ask, jsonb_build_object('costCents', v_ask.cost_cents), 'mediator');
      RETURN 'agreed';
    END IF;
    RETURN v_ask.state;
  END
  $$;

-- Records the PayPal action prepared for the person's own part of an agreed
-- plan in a real circle: the revised subscription, or the invoice, and the
-- PayPal page the person approves it on.
CREATE FUNCTION kin_private.record_my_quiet_share_action(p_circle uuid, p_ask uuid, p_ref text, p_url text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_ask public.quiet_share_asks;
    v_part public.quiet_share_parts;
  BEGIN
    SELECT * INTO v_ask FROM public.quiet_share_asks WHERE circle_id = p_circle AND id = p_ask;
    SELECT * INTO v_part FROM public.quiet_share_parts WHERE circle_id = p_circle AND ask_id = p_ask AND round = v_ask.round AND member_id = v_me FOR UPDATE;
    IF v_me IS NULL OR v_ask.id IS NULL OR v_part.id IS NULL OR v_ask.simulated THEN
      RAISE EXCEPTION 'kin: recording a PayPal action refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_ask.state <> 'agreed' OR v_part.method NOT IN ('monthly_share', 'invoice') THEN
      RAISE EXCEPTION 'kin: nothing to prepare for this part' USING ERRCODE = 'KQ001';
    END IF;
    IF v_part.paypal_ref IS NOT NULL THEN
      RETURN;
    END IF;
    IF p_ref IS NULL OR p_ref !~ '^[A-Za-z0-9-]{1,64}$' THEN
      RAISE EXCEPTION 'kin: not a PayPal reference' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.quiet_share_parts SET paypal_ref = p_ref, approval_url = p_url, prepared_at = now() WHERE id = v_part.id;
  END
  $$;

-- An organizer takes back an ask that is not yet agreed.
CREATE FUNCTION kin_private.withdraw_quiet_share(p_circle uuid, p_ask uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_ask public.quiet_share_asks;
  BEGIN
    IF kin_private.my_role(p_circle) IS DISTINCT FROM 'organizer' OR v_me IS NULL THEN
      RAISE EXCEPTION 'kin: withdrawing a quiet share refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT a.* INTO v_ask FROM public.quiet_share_asks a JOIN public.circles c ON c.id = a.circle_id AND c.status = 'active'
      WHERE a.circle_id = p_circle AND a.id = p_ask FOR UPDATE OF a;
    IF v_ask.id IS NULL THEN
      RAISE EXCEPTION 'kin: withdrawing a quiet share refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_ask.state = 'withdrawn' THEN
      RETURN;
    END IF;
    IF v_ask.state = 'agreed' THEN
      RAISE EXCEPTION 'kin: an agreed plan is not withdrawn' USING ERRCODE = 'KQ001';
    END IF;
    UPDATE public.quiet_share_asks SET state = 'withdrawn', decided_at = now() WHERE circle_id = p_circle AND id = p_ask;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'quiet_share.withdrawn', 'quiet_share', p_ask, '{}'::jsonb, 'web');
  END
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.assert_quiet_share_fixed() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.assert_quiet_part_fixed() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.allocate_cents(bigint, bigint[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.offer_in_month(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.mediate_offers(bigint, text, integer, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.mediate_quiet_share(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.raise_quiet_share(uuid, text, text, bigint, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.seal_my_offer(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.spread_quiet_share(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.take_quiet_share_gap(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.accept_my_quiet_share_part(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.record_my_quiet_share_action(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.withdraw_quiet_share(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.raise_quiet_share(uuid, text, text, bigint, uuid) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.seal_my_offer(uuid, uuid, jsonb) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.spread_quiet_share(uuid, uuid) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.take_quiet_share_gap(uuid, uuid) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.accept_my_quiet_share_part(uuid, uuid, text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.record_my_quiet_share_action(uuid, uuid, text, text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.withdraw_quiet_share(uuid, uuid) TO kin_app;

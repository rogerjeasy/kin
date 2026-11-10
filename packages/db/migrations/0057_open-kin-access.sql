-- Open Kin: who may see and write the delegations a member grants their own
-- AI assistant, the calls that assistant makes, an agency's keys and the
-- visits it reports. Tables delegations, delegation_calls, agency_keys and
-- agency_visit_reports come from the generated migration before this one.
--
-- A delegation token and an agency secret are bearer credentials: the
-- database keeps only their SHA-256, and no role of the web app reads that
-- column. The token is checked by resolve_delegation, open to kin_app with
-- nobody signed in, exactly like a check-in link: it names the member and
-- the scope, and the web app then reads the circle as that member, so
-- row-level security still decides what the assistant sees. What the scope
-- allows is decided in packages/auth; nothing here lets an assistant answer a
-- proposal, because no operation an assistant reaches does.
--
-- Refusals that screens word, by SQLSTATE:
--   42501  the person may not do this, or the token or key is not live
--   KD001  the member already holds five live delegations
--   KD002  the live console's delegation is issued only in a demo circle
--   KA001  the agency sent this visit's ID before with a different body
--   KA002  the key reported more visits today than an agency ever needs
--   KA003  the circle already holds five live agency keys
ALTER TABLE public.delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delegation_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_visit_reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Like every circle table: the service acts for the circle it names, and the
-- provisioner fills the circle it is creating. A member reads their own
-- delegations and the calls made under them; the organizer reads every one,
-- so a delegation nobody remembers can be found and revoked. Whoever sees the
-- circle's money reads its agency keys and the visits reported; a caregiver
-- reads the visits reported about them.
CREATE POLICY service_own_circle ON public.delegations FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY service_own_circle ON public.delegation_calls FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY service_own_circle ON public.agency_keys FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY service_own_circle ON public.agency_visit_reports FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY provisioner_new_circle ON public.delegations FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
CREATE POLICY provisioner_new_circle ON public.delegation_calls FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
CREATE POLICY provisioner_new_circle ON public.agency_keys FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
CREATE POLICY provisioner_new_circle ON public.agency_visit_reports FOR INSERT TO kin_provisioner
  WITH CHECK (kin_private.is_provisioning(circle_id));
CREATE POLICY app_member_read ON public.delegations FOR SELECT TO kin_app
  USING (member_id = kin_private.my_member_id(circle_id) OR kin_private.is_organizer(circle_id));
-- A call is as visible as the delegation it was made under: the subselect is read under that table's policy.
CREATE POLICY app_member_read ON public.delegation_calls FOR SELECT TO kin_app
  USING (EXISTS (
    SELECT 1 FROM public.delegations d
    WHERE d.circle_id = delegation_calls.circle_id AND d.id = delegation_calls.delegation_id
  ));
CREATE POLICY app_member_read ON public.agency_keys FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));
CREATE POLICY app_member_read ON public.agency_visit_reports FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id) OR caregiver_member_id = kin_private.my_member_id(circle_id));
--> statement-breakpoint

-- No role is granted a token's hash or a secret's hash, nor the raw body an
-- agency sent; the service may read the body, as the evidence it is. Only the
-- operations below write.
GRANT SELECT (id, circle_id, member_id, label, scope, token_hint, console, seeded, expires_at, revoked_at, revoked_by, last_used_at, uses, created_at)
  ON public.delegations TO kin_app, kin_service;
GRANT SELECT ON public.delegation_calls TO kin_app, kin_service;
GRANT SELECT (id, circle_id, label, key_id, seeded, created_by, created_at, revoked_at, revoked_by, last_used_at)
  ON public.agency_keys TO kin_app, kin_service;
GRANT SELECT (id, circle_id, agency_key_id, body_sha256, state, refusal, external_id, caregiver_name, caregiver_member_id, kind, starts_at, ends_at,
  checked_in_at, checked_out_at, minutes, note, seeded, received_at) ON public.agency_visit_reports TO kin_app;
GRANT SELECT ON public.agency_visit_reports TO kin_service;
GRANT INSERT ON public.delegations, public.delegation_calls, public.agency_keys, public.agency_visit_reports TO kin_provisioner;
--> statement-breakpoint

-- Nothing here is ever deleted. A call and a report are never changed.
CREATE TRIGGER no_delete BEFORE DELETE ON public.delegations
  FOR EACH ROW EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER no_delete_truncate BEFORE TRUNCATE ON public.delegations
  FOR EACH STATEMENT EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER no_delete BEFORE DELETE ON public.agency_keys
  FOR EACH ROW EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER no_delete_truncate BEFORE TRUNCATE ON public.agency_keys
  FOR EACH STATEMENT EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON public.delegation_calls
  FOR EACH ROW EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON public.delegation_calls
  FOR EACH STATEMENT EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON public.agency_visit_reports
  FOR EACH ROW EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON public.agency_visit_reports
  FOR EACH STATEMENT EXECUTE FUNCTION kin_private.refuse_change();
--> statement-breakpoint

-- What a delegation or a key says never changes. It is revoked once, never
-- back; its use is counted up, never down.
CREATE FUNCTION kin_private.assert_credential_fixed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF (to_jsonb(NEW) - ARRAY['revoked_at', 'revoked_by', 'last_used_at', 'uses']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['revoked_at', 'revoked_by', 'last_used_at', 'uses']) THEN
      RAISE EXCEPTION 'kin: % % cannot change what it says', TG_TABLE_NAME, OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by) THEN
      RAISE EXCEPTION 'kin: % % was revoked and stays revoked', TG_TABLE_NAME, OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF (to_jsonb(NEW) ->> 'uses')::bigint < (to_jsonb(OLD) ->> 'uses')::bigint THEN
      RAISE EXCEPTION 'kin: % % cannot count its uses down', TG_TABLE_NAME, OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER credential_fixed BEFORE UPDATE ON public.delegations
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_credential_fixed();
CREATE TRIGGER credential_fixed BEFORE UPDATE ON public.agency_keys
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_credential_fixed();
--> statement-breakpoint

-- Nothing a member's own assistant starts is approved in the same breath. The
-- web app opens every write an assistant causes with kin.delegation_id set
-- (asDelegate in packages/db); while it is set, no approval of any kind is
-- written, the parent's standing permission included, so a refill an
-- assistant proposes always waits for a person's yes in Kin. An approval is
-- otherwise unchanged: this only refuses.
CREATE FUNCTION kin_private.refuse_approval_under_delegation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF nullif(current_setting('kin.delegation_id', true), '') IS NOT NULL THEN
      RAISE EXCEPTION 'kin: an outside assistant cannot approve, and nothing it starts is approved for it' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER no_approval_under_delegation BEFORE INSERT ON public.approvals
  FOR EACH ROW EXECUTE FUNCTION kin_private.refuse_approval_under_delegation();
CREATE TRIGGER no_approval_under_delegation BEFORE UPDATE OF state ON public.proposals
  FOR EACH ROW WHEN (NEW.state IS DISTINCT FROM OLD.state AND NEW.state = 'approved')
  EXECUTE FUNCTION kin_private.refuse_approval_under_delegation();
--> statement-breakpoint

-- Grants a delegation for the person's own seat, from the hash of a token the
-- web app made and will show once. Any active member but an observer may: the
-- scope only ever narrows their own role, in packages/auth. It lasts from an hour to ninety
-- days, and a member holds at most five live ones. The live console's
-- delegation lasts fifteen minutes, exists only in a demo circle, and
-- replaces the member's previous one.
CREATE FUNCTION kin_private.grant_delegation(p_circle uuid, p_label text, p_scope text, p_token_hash text, p_hint text, p_expires_at timestamptz, p_console boolean) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_demo boolean;
    v_id uuid := gen_random_uuid();
  BEGIN
    -- An observer reads and never writes, so connects no assistant.
    IF v_me IS NULL OR kin_private.my_role(p_circle) = 'observer' THEN
      RAISE EXCEPTION 'kin: granting a delegation refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT c.demo INTO v_demo FROM public.circles c WHERE c.id = p_circle AND c.status = 'active' FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: granting a delegation refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_console THEN
      IF NOT v_demo THEN
        RAISE EXCEPTION 'kin: the live console works only in a demo circle' USING ERRCODE = 'KD002';
      END IF;
      IF p_expires_at <= now() OR p_expires_at > now() + interval '16 minutes' THEN
        RAISE EXCEPTION 'kin: the console delegation lasts fifteen minutes' USING ERRCODE = 'check_violation';
      END IF;
      UPDATE public.delegations SET revoked_at = now(), revoked_by = v_me
        WHERE circle_id = p_circle AND member_id = v_me AND console AND revoked_at IS NULL;
    ELSE
      IF p_expires_at < now() + interval '59 minutes' OR p_expires_at > now() + interval '91 days' THEN
        RAISE EXCEPTION 'kin: a delegation lasts from an hour to ninety days' USING ERRCODE = 'check_violation';
      END IF;
      IF (SELECT count(*) FROM public.delegations
          WHERE circle_id = p_circle AND member_id = v_me AND NOT console AND revoked_at IS NULL AND expires_at > now()) >= 5 THEN
        RAISE EXCEPTION 'kin: five live delegations already' USING ERRCODE = 'KD001';
      END IF;
    END IF;
    INSERT INTO public.delegations (id, circle_id, member_id, label, scope, token_hash, token_hint, console, expires_at)
      VALUES (v_id, p_circle, v_me, btrim(p_label), p_scope, p_token_hash, p_hint, p_console, p_expires_at);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'delegation.granted', 'delegation', v_id,
        jsonb_build_object('scope', p_scope, 'console', p_console, 'expiresAt', p_expires_at), 'web');
    RETURN v_id;
  END
  $$;
--> statement-breakpoint

-- Revokes a delegation: the member's own, or any in the circle for the
-- organizer. The next call with its token is refused. Returns whether this
-- call revoked it: false when it was already.
CREATE FUNCTION kin_private.revoke_delegation(p_circle uuid, p_delegation uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_row public.delegations;
  BEGIN
    SELECT * INTO v_row FROM public.delegations WHERE circle_id = p_circle AND id = p_delegation FOR UPDATE;
    IF v_me IS NULL OR NOT FOUND OR NOT (v_row.member_id = v_me OR kin_private.is_organizer(p_circle)) THEN
      RAISE EXCEPTION 'kin: revoking a delegation refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_row.revoked_at IS NOT NULL THEN
      RETURN false;
    END IF;
    UPDATE public.delegations SET revoked_at = now(), revoked_by = v_me WHERE circle_id = p_circle AND id = p_delegation;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'delegation.revoked', 'delegation', p_delegation, '{}'::jsonb, 'web');
    RETURN true;
  END
  $$;
--> statement-breakpoint

-- The delegation a token's hash names, if it is live: not revoked, not
-- expired, for a member who is active in an active circle and holds a seat a
-- person signs in to. Counts the use. Open to kin_app with nobody signed in;
-- any token that is not live returns null and nothing more, so a caller never
-- learns whether a token exists.
CREATE FUNCTION kin_private.resolve_delegation(p_token_hash text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_found record;
  BEGIN
    IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
      RETURN NULL;
    END IF;
    SELECT d.id, d.circle_id, d.member_id, d.scope, m.user_id, m.role, u.language INTO v_found
      FROM public.delegations d
      JOIN public.members m ON m.circle_id = d.circle_id AND m.id = d.member_id
      JOIN public.circles c ON c.id = d.circle_id
      JOIN public.users u ON u.id = m.user_id
      WHERE d.token_hash = p_token_hash AND d.revoked_at IS NULL AND d.expires_at > now()
        AND m.status = 'active' AND c.status = 'active'
      FOR UPDATE OF d;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    UPDATE public.delegations SET last_used_at = now(), uses = uses + 1 WHERE id = v_found.id;
    RETURN jsonb_build_object('delegationId', v_found.id, 'circleId', v_found.circle_id, 'memberId', v_found.member_id, 'userId', v_found.user_id,
      'role', v_found.role, 'scope', v_found.scope, 'language', v_found.language);
  END
  $$;
--> statement-breakpoint

-- Records one tool call made under the delegation a token's hash names, live
-- or revoked since: only whoever holds the token can record against it. The
-- call is stamped within ten minutes of the database's clock.
CREATE FUNCTION kin_private.record_delegation_call(p_token_hash text, p_tool text, p_outcome text, p_duration_ms integer, p_proposal uuid, p_at timestamptz) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_row public.delegations;
  BEGIN
    SELECT * INTO v_row FROM public.delegations WHERE token_hash = p_token_hash;
    IF NOT FOUND OR p_at IS NULL OR abs(extract(epoch FROM (now() - p_at))) > 600 THEN
      RAISE EXCEPTION 'kin: recording a call refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO public.delegation_calls (id, circle_id, delegation_id, tool, outcome, duration_ms, proposal_id, at)
      VALUES (gen_random_uuid(), v_row.circle_id, v_row.id, p_tool, p_outcome, p_duration_ms, p_proposal, p_at);
  END
  $$;
--> statement-breakpoint

-- The organizer creates a key for an agency, from the key's public ID and the
-- SHA-256 of the secret the web app derived and will show once. A circle
-- holds at most five live keys.
CREATE FUNCTION kin_private.create_agency_key(p_circle uuid, p_label text, p_key_id text, p_secret_hash text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_id uuid := gen_random_uuid();
  BEGIN
    IF v_me IS NULL OR NOT kin_private.is_organizer(p_circle) THEN
      RAISE EXCEPTION 'kin: creating an agency key refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM 1 FROM public.circles WHERE id = p_circle AND status = 'active' FOR UPDATE;
    IF (SELECT count(*) FROM public.agency_keys WHERE circle_id = p_circle AND revoked_at IS NULL) >= 5 THEN
      RAISE EXCEPTION 'kin: five live agency keys already' USING ERRCODE = 'KA003';
    END IF;
    INSERT INTO public.agency_keys (id, circle_id, label, key_id, secret_hash, created_by)
      VALUES (v_id, p_circle, btrim(p_label), p_key_id, p_secret_hash, v_me);
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'agency_key.created', 'agency_key', v_id, jsonb_build_object('keyId', p_key_id), 'web');
    RETURN v_id;
  END
  $$;
--> statement-breakpoint

CREATE FUNCTION kin_private.revoke_agency_key(p_circle uuid, p_key uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_me uuid := kin_private.my_member_id(p_circle);
    v_row public.agency_keys;
  BEGIN
    SELECT * INTO v_row FROM public.agency_keys WHERE circle_id = p_circle AND id = p_key FOR UPDATE;
    IF v_me IS NULL OR NOT FOUND OR NOT kin_private.is_organizer(p_circle) THEN
      RAISE EXCEPTION 'kin: revoking an agency key refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_row.revoked_at IS NOT NULL THEN
      RETURN false;
    END IF;
    UPDATE public.agency_keys SET revoked_at = now(), revoked_by = v_me WHERE circle_id = p_circle AND id = p_key;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_me, 'agency_key.revoked', 'agency_key', p_key, '{}'::jsonb, 'web');
    RETURN true;
  END
  $$;
--> statement-breakpoint

-- Keeps one visit an agency reported, for the live key whose ID and secret
-- hash the web app verified the signature with. Open to kin_app with nobody
-- signed in. The raw body is kept as it arrived; `p_report` is the domain's
-- parsed report, or null with `p_refusal` when the body was not one. The same
-- external ID with the same body returns the report already kept; with
-- another body it is refused. The caregiver's name is matched to the
-- circle's active caregivers, and kept matched only when exactly one fits.
-- Nothing else is written: no shift, no proposal, no payment.
CREATE FUNCTION kin_private.receive_agency_visit(p_key_id text, p_secret_hash text, p_raw text, p_report jsonb, p_refusal text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_key public.agency_keys;
    v_sha text := encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
    v_id uuid := gen_random_uuid();
    v_existing public.agency_visit_reports;
    v_caregiver uuid;
    v_matches integer;
  BEGIN
    SELECT k.* INTO v_key FROM public.agency_keys k JOIN public.circles c ON c.id = k.circle_id AND c.status = 'active'
      WHERE k.key_id = p_key_id AND k.secret_hash = p_secret_hash AND k.revoked_at IS NULL FOR UPDATE OF k;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: this agency key is not live' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF (SELECT count(*) FROM public.agency_visit_reports WHERE agency_key_id = v_key.id AND received_at > now() - interval '1 day') >= 1000 THEN
      RAISE EXCEPTION 'kin: too many visits reported today' USING ERRCODE = 'KA002';
    END IF;
    UPDATE public.agency_keys SET last_used_at = now() WHERE id = v_key.id;
    IF p_report IS NULL THEN
      INSERT INTO public.agency_visit_reports (id, circle_id, agency_key_id, raw_body, body_sha256, state, refusal)
        VALUES (v_id, v_key.circle_id, v_key.id, p_raw, v_sha, 'refused', p_refusal);
      RETURN jsonb_build_object('id', v_id, 'state', 'refused', 'duplicate', false);
    END IF;
    SELECT * INTO v_existing FROM public.agency_visit_reports WHERE agency_key_id = v_key.id AND external_id = p_report ->> 'externalId';
    IF FOUND THEN
      IF v_existing.body_sha256 = v_sha THEN
        RETURN jsonb_build_object('id', v_existing.id, 'state', 'accepted', 'duplicate', true, 'caregiverMatched', v_existing.caregiver_member_id IS NOT NULL);
      END IF;
      RAISE EXCEPTION 'kin: this visit was reported before with another body' USING ERRCODE = 'KA001';
    END IF;
    SELECT count(*), min(m.id::text)::uuid INTO v_matches, v_caregiver FROM public.members m
      WHERE m.circle_id = v_key.circle_id AND m.role = 'caregiver' AND m.status = 'active'
        AND (lower(btrim(m.display_name)) = lower(p_report ->> 'caregiver') OR lower(split_part(btrim(m.display_name), ' ', 1)) = lower(p_report ->> 'caregiver'));
    IF v_matches <> 1 THEN
      v_caregiver := NULL;
    END IF;
    INSERT INTO public.agency_visit_reports (id, circle_id, agency_key_id, raw_body, body_sha256, state, external_id, caregiver_name, caregiver_member_id,
        kind, starts_at, ends_at, checked_in_at, checked_out_at, minutes, note)
      VALUES (v_id, v_key.circle_id, v_key.id, p_raw, v_sha, 'accepted', p_report ->> 'externalId', p_report ->> 'caregiver', v_caregiver,
        p_report ->> 'kind', (p_report ->> 'startsAt')::timestamptz, (p_report ->> 'endsAt')::timestamptz,
        (p_report ->> 'checkedInAt')::timestamptz, (p_report ->> 'checkedOutAt')::timestamptz, (p_report ->> 'minutes')::integer, p_report ->> 'note');
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), v_key.circle_id, 'service', NULL, 'agency.visit_reported', 'agency_visit_report', v_id,
        jsonb_build_object('externalId', p_report ->> 'externalId', 'caregiverMatched', v_caregiver IS NOT NULL), 'agency:' || v_key.key_id);
    RETURN jsonb_build_object('id', v_id, 'state', 'accepted', 'duplicate', false, 'caregiverMatched', v_caregiver IS NOT NULL);
  END
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.refuse_approval_under_delegation() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.assert_credential_fixed() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.grant_delegation(uuid, text, text, text, text, timestamptz, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.revoke_delegation(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.resolve_delegation(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.record_delegation_call(text, text, text, integer, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.create_agency_key(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.revoke_agency_key(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.receive_agency_visit(text, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.grant_delegation(uuid, text, text, text, text, timestamptz, boolean) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.revoke_delegation(uuid, uuid) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.resolve_delegation(text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.record_delegation_call(text, text, text, integer, uuid, timestamptz) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.create_agency_key(uuid, text, text, text) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.revoke_agency_key(uuid, uuid) TO kin_app;
GRANT EXECUTE ON FUNCTION kin_private.receive_agency_visit(text, text, text, jsonb, text) TO kin_app;

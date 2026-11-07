-- Access rules for audit_heads (docs/architecture.md decision 66). The table
-- comes from the generated migration before this one.
--
-- A head is the last hash of a circle's ledger chain when Kin showed or
-- exported it. Later exports are checked against every head kept, so a past
-- entry that was changed or removed no longer fits. The rows are evidence:
-- nothing updates, deletes or truncates them, and a person never writes one
-- directly, only through the operation below.
ALTER TABLE public.audit_heads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Like every circle table: the service acts for the circle it names. A person
-- reads the circle's heads unless they are a caregiver, who sees none of the
-- family's record.
CREATE POLICY service_own_circle ON public.audit_heads FOR ALL TO kin_service
  USING (circle_id = kin_private.circle_id()) WITH CHECK (circle_id = kin_private.circle_id());
CREATE POLICY app_member_read ON public.audit_heads FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));

GRANT SELECT ON public.audit_heads TO kin_app;
GRANT SELECT, INSERT ON public.audit_heads TO kin_service;
--> statement-breakpoint

CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON public.audit_heads
  FOR EACH ROW EXECUTE FUNCTION kin_private.refuse_change();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON public.audit_heads
  FOR EACH STATEMENT EXECUTE FUNCTION kin_private.refuse_change();
--> statement-breakpoint

-- Keeps the head of the chain as the app computed it. The organizer, a
-- contributor and the parent may; an observer reads and never writes, and a
-- caregiver sees none of it. The database cannot recompute the SHA-256 chain,
-- but it keeps a head only for the number of entries the ledger holds right
-- now, so a head always names a state the circle really reached. The same head
-- at the same count is kept once. Returns whether this call kept one: false
-- for a retry, or when the ledger has moved on since the app read it.
CREATE FUNCTION kin_private.record_audit_head(p_circle uuid, p_count integer, p_head text, p_kind text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_member uuid := kin_private.my_member_id(p_circle);
    v_id uuid := gen_random_uuid();
    v_added integer;
  BEGIN
    IF kin_private.my_role(p_circle) IS NULL OR kin_private.my_role(p_circle) NOT IN ('organizer', 'contributor', 'parent') THEN
      RAISE EXCEPTION 'kin: recording a head refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_kind NOT IN ('verify', 'export') OR p_head !~ '^[0-9a-f]{64}$' OR p_count < 0 THEN
      RAISE EXCEPTION 'kin: the head is not valid' USING ERRCODE = 'check_violation';
    END IF;
    -- The ledger took an entry (or the page was stale) since the app read it: keep nothing, and the next visit keeps the new head.
    IF p_count <> (SELECT count(*)::integer FROM public.ledger_entries WHERE circle_id = p_circle) THEN
      RETURN false;
    END IF;
    INSERT INTO public.audit_heads (id, circle_id, entry_count, head, kind, recorded_by)
      VALUES (v_id, p_circle, p_count, p_head, p_kind, v_member)
      ON CONFLICT (circle_id, entry_count, head) DO NOTHING;
    GET DIAGNOSTICS v_added = ROW_COUNT;
    IF v_added = 0 THEN
      RETURN false;
    END IF;
    INSERT INTO public.audit_log (id, circle_id, actor, member_id, action, subject_type, subject_id, details, origin)
      VALUES (gen_random_uuid(), p_circle, 'member', v_member, 'audit_head.recorded', 'audit_head', v_id,
              jsonb_build_object('entryCount', p_count, 'kind', p_kind), 'web');
    RETURN true;
  END
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.record_audit_head(uuid, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.record_audit_head(uuid, integer, text, text) TO kin_app;

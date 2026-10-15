-- Kin's access control and money rules inside the database
-- (docs/architecture.md sections 7 and 12.3). The services check access too;
-- this is the layer that still holds when a query forgets its filter.
--
-- Three roles connect. None owns a table or bypasses row-level security.
--   kin_app          a signed-in person. Sees the circles they belong to,
--                    through kin.user_id, set for each transaction.
--   kin_service      Kin's own worker. Acts for one circle at a time, through
--                    kin.circle_id, set for each transaction.
--   kin_provisioner  creates demo circles. May only add rows, and only to a
--                    circle created in its own transaction. It reads nothing.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kin_app') THEN
    CREATE ROLE kin_app NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kin_service') THEN
    CREATE ROLE kin_service NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kin_provisioner') THEN
    CREATE ROLE kin_provisioner NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

-- Drizzle cannot express this one: circles and members refer to each other.
ALTER TABLE "circles" ADD CONSTRAINT "circles_paused_by_fk"
  FOREIGN KEY ("id", "paused_by") REFERENCES "public"."members"("circle_id", "id");
--> statement-breakpoint

CREATE SCHEMA kin_private;
REVOKE ALL ON SCHEMA kin_private FROM PUBLIC;
--> statement-breakpoint

-- Who is asking. Empty or unset means nobody, so every policy fails closed.
CREATE FUNCTION kin_private.user_id() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('kin.user_id', true), '') $$;

CREATE FUNCTION kin_private.circle_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('kin.circle_id', true), '')::uuid $$;

-- The helpers below read members and payees as their owner, so that a policy
-- on members can ask about membership without asking itself.
CREATE FUNCTION kin_private.my_role(p_circle uuid) RETURNS public.circle_role
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT m.role FROM public.members m
    JOIN public.circles c ON c.id = m.circle_id
    WHERE m.circle_id = p_circle
      AND m.user_id = kin_private.user_id()
      AND m.status = 'active'
      AND c.status = 'active'
  $$;

CREATE FUNCTION kin_private.my_member_id(p_circle uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT m.id FROM public.members m
    JOIN public.circles c ON c.id = m.circle_id
    WHERE m.circle_id = p_circle
      AND m.user_id = kin_private.user_id()
      AND m.status = 'active'
      AND c.status = 'active'
  $$;

-- Every active member except a caregiver sees the circle's money.
CREATE FUNCTION kin_private.sees_circle_money(p_circle uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(kin_private.my_role(p_circle) <> 'caregiver', false) $$;

CREATE FUNCTION kin_private.is_member(p_circle uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT kin_private.my_role(p_circle) IS NOT NULL $$;

CREATE FUNCTION kin_private.is_organizer(p_circle uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(kin_private.my_role(p_circle) = 'organizer', false) $$;

-- A caregiver sees only what pays them: the payees that are their own seat.
CREATE FUNCTION kin_private.is_my_payee(p_circle uuid, p_payee uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.payees p
      WHERE p.circle_id = p_circle AND p.id = p_payee
        AND p.member_id = kin_private.my_member_id(p_circle)
    )
  $$;

CREATE FUNCTION kin_private.is_my_account(p_circle uuid, p_account uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.ledger_accounts a
      WHERE a.circle_id = p_circle AND a.id = p_account
        AND (a.member_id = kin_private.my_member_id(p_circle)
             OR kin_private.is_my_payee(p_circle, a.payee_id))
    )
  $$;

CREATE FUNCTION kin_private.is_my_entry(p_circle uuid, p_entry uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.ledger_lines l
      WHERE l.circle_id = p_circle AND l.entry_id = p_entry
        AND kin_private.is_my_account(p_circle, l.account_id)
    )
  $$;

-- The accounts on a caregiver's own entries, so each entry reads whole.
CREATE FUNCTION kin_private.is_account_on_my_entries(p_circle uuid, p_account uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.ledger_lines l
      WHERE l.circle_id = p_circle AND l.account_id = p_account
        AND kin_private.is_my_entry(p_circle, l.entry_id)
    )
  $$;

CREATE FUNCTION kin_private.is_my_proposal(p_circle uuid, p_proposal uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.circle_id = p_circle AND p.id = p_proposal
        AND (p.member_id = kin_private.my_member_id(p_circle)
             OR p.raised_by = kin_private.my_member_id(p_circle)
             OR kin_private.is_my_payee(p_circle, p.payee_id))
    )
  $$;

-- The provisioner may fill a circle only inside the transaction that made it.
CREATE FUNCTION kin_private.is_provisioning(p_circle uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.circles c
      WHERE c.id = p_circle AND c.provisioned_txid = txid_current()
    )
  $$;
--> statement-breakpoint

-- Row-level security on every table, and the two policies every circle table
-- shares: the service acts for the circle it names, and the provisioner adds
-- rows to the circle it is creating.
DO $$
DECLARE
  t text;
  circle_tables text[] := ARRAY[
    'members', 'invitations', 'agreements', 'agreement_shares', 'agreement_acceptances',
    'payees', 'documents', 'bills', 'expected_bills', 'care_entries',
    'ledger_accounts', 'ledger_entries', 'ledger_lines',
    'proposals', 'approvals', 'executions',
    'settlements', 'claim_checks', 'narrations',
    'paypal_events', 'outbox', 'audit_log'
  ];
BEGIN
  ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.circles ENABLE ROW LEVEL SECURITY;
  FOREACH t IN ARRAY circle_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY service_own_circle ON public.%I FOR ALL TO kin_service
         USING (circle_id = kin_private.circle_id())
         WITH CHECK (circle_id = kin_private.circle_id())', t);
    EXECUTE format(
      'CREATE POLICY provisioner_new_circle ON public.%I FOR INSERT TO kin_provisioner
         WITH CHECK (kin_private.is_provisioning(circle_id))', t);
  END LOOP;
END
$$;
--> statement-breakpoint

-- users: a person sees and keeps only their own row.
CREATE POLICY app_own_user ON public.users FOR SELECT TO kin_app
  USING (id = kin_private.user_id());
CREATE POLICY app_own_user_insert ON public.users FOR INSERT TO kin_app
  WITH CHECK (id = kin_private.user_id());
CREATE POLICY app_own_user_update ON public.users FOR UPDATE TO kin_app
  USING (id = kin_private.user_id()) WITH CHECK (id = kin_private.user_id());
CREATE POLICY service_circle_users ON public.users FOR SELECT TO kin_service
  USING (EXISTS (SELECT 1 FROM public.members m WHERE m.user_id = users.id));

-- circles
CREATE POLICY app_member_circle ON public.circles FOR SELECT TO kin_app
  USING (kin_private.is_member(id));
CREATE POLICY service_own_circle ON public.circles FOR ALL TO kin_service
  USING (id = kin_private.circle_id()) WITH CHECK (id = kin_private.circle_id());
CREATE POLICY provisioner_new_circle ON public.circles FOR INSERT TO kin_provisioner
  WITH CHECK (provisioned_txid = txid_current() AND status = 'active' AND demo);

-- Who is in the circle: every member sees every member.
CREATE POLICY app_member_read ON public.members FOR SELECT TO kin_app
  USING (kin_private.is_member(circle_id));

-- The money and its rules: everyone but a caregiver.
CREATE POLICY app_member_read ON public.agreements FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));
CREATE POLICY app_member_read ON public.agreement_shares FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));
CREATE POLICY app_member_read ON public.agreement_acceptances FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));
CREATE POLICY app_member_read ON public.settlements FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));
CREATE POLICY app_member_read ON public.claim_checks FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));
CREATE POLICY app_member_read ON public.narrations FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id));

-- A caregiver sees their own bills, payments and care, and nothing else.
CREATE POLICY app_member_read ON public.payees FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id) OR kin_private.is_my_payee(circle_id, id));
CREATE POLICY app_member_read ON public.bills FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id) OR kin_private.is_my_payee(circle_id, payee_id));
CREATE POLICY app_member_read ON public.expected_bills FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id) OR kin_private.is_my_payee(circle_id, payee_id));
CREATE POLICY app_member_read ON public.documents FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id)
         OR (kin_private.is_member(circle_id) AND uploaded_by = kin_private.my_member_id(circle_id)));
CREATE POLICY app_member_read ON public.care_entries FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id)
         OR (kin_private.is_member(circle_id) AND member_id = kin_private.my_member_id(circle_id)));
CREATE POLICY app_member_read ON public.ledger_accounts FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id) OR kin_private.is_account_on_my_entries(circle_id, id));
CREATE POLICY app_member_read ON public.ledger_entries FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id) OR kin_private.is_my_entry(circle_id, id));
CREATE POLICY app_member_read ON public.ledger_lines FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id) OR kin_private.is_my_entry(circle_id, entry_id));
CREATE POLICY app_member_read ON public.proposals FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id) OR kin_private.is_my_proposal(circle_id, id));
CREATE POLICY app_member_read ON public.approvals FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id) OR kin_private.is_my_proposal(circle_id, proposal_id));
CREATE POLICY app_member_read ON public.executions FOR SELECT TO kin_app
  USING (kin_private.sees_circle_money(circle_id) OR kin_private.is_my_proposal(circle_id, proposal_id));

-- Running the circle: organizers only.
CREATE POLICY app_organizer_read ON public.invitations FOR SELECT TO kin_app
  USING (kin_private.is_organizer(circle_id));
CREATE POLICY app_organizer_read ON public.audit_log FOR SELECT TO kin_app
  USING (kin_private.is_organizer(circle_id));

-- paypal_events and outbox have no policy for kin_app: no person reads them.
--> statement-breakpoint

-- What each role may attempt at all. Row-level security then narrows it.
GRANT USAGE ON SCHEMA public TO kin_app, kin_service, kin_provisioner;
GRANT USAGE ON SCHEMA kin_private TO kin_app, kin_service, kin_provisioner;
-- A visitor may start their demo again: their demo circle is archived, never
-- deleted, and only the circle in which they hold the demo seat.
CREATE FUNCTION kin_private.leave_demo_circle(p_circle uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    UPDATE public.members SET status = 'left'
      WHERE circle_id = p_circle AND user_id = kin_private.user_id() AND demo_seat AND status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kin: % holds no demo seat in circle %', coalesce(kin_private.user_id(), 'nobody'), p_circle
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE public.circles SET status = 'archived' WHERE id = p_circle AND demo;
  END
  $$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA kin_private FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA kin_private TO kin_app, kin_service, kin_provisioner;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO kin_app;
GRANT INSERT, UPDATE ON public.users TO kin_app;

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO kin_service;
REVOKE INSERT, UPDATE ON public.users FROM kin_service;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO kin_service;

GRANT INSERT ON ALL TABLES IN SCHEMA public TO kin_provisioner;
REVOKE INSERT ON public.users FROM kin_provisioner;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO kin_provisioner;
--> statement-breakpoint

-- Records that are evidence never change: the ledger, the answers given, the
-- agreement versions and the audit log. A correction is a new row.
CREATE FUNCTION kin_private.refuse_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'kin: % is append-only, so % is refused', TG_TABLE_NAME, TG_OP
      USING ERRCODE = 'restrict_violation';
  END
  $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ledger_entries', 'ledger_lines', 'approvals',
    'agreements', 'agreement_shares', 'agreement_acceptances', 'audit_log'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION kin_private.refuse_change()', t);
    EXECUTE format(
      'CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON public.%I
         FOR EACH STATEMENT EXECUTE FUNCTION kin_private.refuse_change()', t);
  END LOOP;
END
$$;
--> statement-breakpoint

-- Every entry balances, with at least two lines, checked when the transaction
-- commits, after all of its lines are in.
CREATE FUNCTION kin_private.assert_entry_balanced() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_entry uuid;
    v_lines integer;
    v_debits bigint;
    v_credits bigint;
  BEGIN
    -- Each branch reads only the column its own table has.
    IF TG_TABLE_NAME = 'ledger_entries' THEN
      v_entry := NEW.id;
    ELSE
      v_entry := NEW.entry_id;
    END IF;
    SELECT count(*),
           coalesce(sum(cents) FILTER (WHERE direction = 'debit'), 0),
           coalesce(sum(cents) FILTER (WHERE direction = 'credit'), 0)
      INTO v_lines, v_debits, v_credits
      FROM public.ledger_lines WHERE entry_id = v_entry;
    IF v_lines < 2 THEN
      RAISE EXCEPTION 'kin: ledger entry % needs at least two lines', v_entry
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_debits <> v_credits THEN
      RAISE EXCEPTION 'kin: ledger entry % does not balance: debits %, credits %', v_entry, v_debits, v_credits
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END
  $$;

CREATE CONSTRAINT TRIGGER entry_balanced AFTER INSERT ON public.ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kin_private.assert_entry_balanced();
CREATE CONSTRAINT TRIGGER entry_balanced AFTER INSERT ON public.ledger_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kin_private.assert_entry_balanced();

-- Lines join their entry in the transaction that wrote it, never later.
CREATE FUNCTION kin_private.assert_line_with_entry() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM public.ledger_entries e
      WHERE e.id = NEW.entry_id AND e.created_txid = txid_current()
    ) THEN
      RAISE EXCEPTION 'kin: lines can only be added in the transaction that wrote entry %', NEW.entry_id
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER line_with_entry BEFORE INSERT ON public.ledger_lines
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_line_with_entry();

-- A reversal cancels an entry of its own kind and currency.
CREATE FUNCTION kin_private.assert_reversal_matches() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NEW.reverses IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.ledger_entries o
      WHERE o.id = NEW.reverses AND o.kind = NEW.kind AND o.currency = NEW.currency
        AND o.reverses IS NULL
    ) THEN
      RAISE EXCEPTION 'kin: entry % does not reverse an original of its own kind and currency', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER reversal_matches BEFORE INSERT ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_reversal_matches();

-- An entry is in its circle's currency.
CREATE FUNCTION kin_private.assert_circle_currency() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.circles c WHERE c.id = NEW.circle_id AND c.currency = NEW.currency) THEN
      RAISE EXCEPTION 'kin: entry % is not in its circle''s currency', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER circle_currency BEFORE INSERT ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_circle_currency();
--> statement-breakpoint

-- A version's shares total 10 000 basis points, checked at commit.
CREATE FUNCTION kin_private.assert_shares_whole() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_total bigint;
  BEGIN
    SELECT coalesce(sum(bps), 0) INTO v_total FROM public.agreement_shares WHERE agreement_id = NEW.agreement_id;
    IF v_total <> 10000 THEN
      RAISE EXCEPTION 'kin: the shares of agreement % total % basis points, not 10000', NEW.agreement_id, v_total
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END
  $$;

CREATE CONSTRAINT TRIGGER shares_whole AFTER INSERT ON public.agreement_shares
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kin_private.assert_shares_whole();
--> statement-breakpoint

-- The state machines of docs/architecture.md section 7.4. A test checks this
-- table against packages/domain, so the two cannot drift apart.
CREATE TABLE kin_private.state_transitions (
  machine text NOT NULL,
  from_state text NOT NULL,
  to_state text NOT NULL,
  PRIMARY KEY (machine, from_state, to_state)
);

INSERT INTO kin_private.state_transitions (machine, from_state, to_state) VALUES
  ('proposal', 'proposed', 'pending_approval'),
  ('proposal', 'pending_approval', 'approved'),
  ('proposal', 'pending_approval', 'rejected'),
  ('proposal', 'pending_approval', 'expired'),
  ('proposal', 'pending_approval', 'cancelled'),
  ('proposal', 'approved', 'executing'),
  ('proposal', 'executing', 'settled'),
  ('proposal', 'executing', 'failed'),
  ('proposal', 'failed', 'executing'),
  ('proposal', 'failed', 'cancelled'),
  ('bill', 'received', 'extracted'),
  ('bill', 'extracted', 'needs_review'),
  ('bill', 'extracted', 'ready'),
  ('bill', 'extracted', 'duplicate'),
  ('bill', 'needs_review', 'ready'),
  ('bill', 'needs_review', 'rejected'),
  ('bill', 'ready', 'proposed'),
  ('bill', 'proposed', 'paid'),
  ('bill', 'proposed', 'ready'),
  ('execution', 'created', 'submitted'),
  ('execution', 'submitted', 'confirmed'),
  ('execution', 'submitted', 'pending_at_paypal'),
  ('execution', 'submitted', 'failed'),
  ('execution', 'submitted', 'unknown'),
  ('execution', 'pending_at_paypal', 'confirmed'),
  ('execution', 'pending_at_paypal', 'failed'),
  ('execution', 'unknown', 'confirmed'),
  ('execution', 'unknown', 'failed');

CREATE FUNCTION kin_private.assert_transition() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NEW.state IS DISTINCT FROM OLD.state AND NOT EXISTS (
      SELECT 1 FROM kin_private.state_transitions s
      WHERE s.machine = TG_ARGV[0] AND s.from_state = OLD.state::text AND s.to_state = NEW.state::text
    ) THEN
      RAISE EXCEPTION 'kin: a % cannot move from % to %', TG_ARGV[0], OLD.state, NEW.state
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER state_moves_forward BEFORE UPDATE OF state ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_transition('proposal');
CREATE TRIGGER state_moves_forward BEFORE UPDATE OF state ON public.bills
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_transition('bill');
CREATE TRIGGER state_moves_forward BEFORE UPDATE OF state ON public.executions
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_transition('execution');

-- What was approved is what executes: after it is raised, only a proposal's
-- state and expiry can change.
CREATE FUNCTION kin_private.assert_proposal_terms_fixed() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF (to_jsonb(NEW) - 'state' - 'expires_at') IS DISTINCT FROM (to_jsonb(OLD) - 'state' - 'expires_at') THEN
      RAISE EXCEPTION 'kin: proposal % cannot change after it is raised, only move through its states', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER terms_fixed BEFORE UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_proposal_terms_fixed();

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA kin_private FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA kin_private TO kin_app, kin_service, kin_provisioner;

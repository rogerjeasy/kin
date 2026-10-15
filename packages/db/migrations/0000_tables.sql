CREATE TYPE "public"."approval_method" AS ENUM('app', 'voice');--> statement-breakpoint
CREATE TYPE "public"."audit_actor" AS ENUM('member', 'service', 'provisioner');--> statement-breakpoint
CREATE TYPE "public"."bill_state" AS ENUM('received', 'extracted', 'needs_review', 'ready', 'proposed', 'paid', 'rejected', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."circle_role" AS ENUM('organizer', 'contributor', 'parent', 'caregiver', 'observer');--> statement-breakpoint
CREATE TYPE "public"."circle_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."claim_verdict" AS ENUM('match', 'no_match', 'unclear');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('bill', 'receipt', 'quote', 'letter', 'other');--> statement-breakpoint
CREATE TYPE "public"."entry_kind" AS ENUM('contribution', 'out_of_pocket', 'bill_approved', 'payout_confirmed', 'purchase_captured', 'settlement_collection', 'settlement_payout', 'care_credit');--> statement-breakpoint
CREATE TYPE "public"."entry_source_type" AS ENUM('paypal_event', 'approval', 'settlement');--> statement-breakpoint
CREATE TYPE "public"."execution_state" AS ENUM('created', 'submitted', 'pending_at_paypal', 'unknown', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('invited', 'active', 'left');--> statement-breakpoint
CREATE TYPE "public"."narration_state" AS ENUM('queued', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."parent_level" AS ENUM('decides', 'informed', 'represented');--> statement-breakpoint
CREATE TYPE "public"."payee_status" AS ENUM('approved', 'new');--> statement-breakpoint
CREATE TYPE "public"."paypal_event_state" AS ENUM('received', 'verified', 'rejected', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."proposal_kind" AS ENUM('bill_payment', 'caregiver_payout', 'member_payout', 'purchase');--> statement-breakpoint
CREATE TYPE "public"."proposal_state" AS ENUM('proposed', 'pending_approval', 'approved', 'executing', 'failed', 'settled', 'rejected', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."settlement_state" AS ENUM('proposed', 'approved', 'settled', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."vote_decision" AS ENUM('approve', 'reject');--> statement-breakpoint
CREATE TABLE "circles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "circle_status" DEFAULT 'active' NOT NULL,
	"demo" boolean DEFAULT false NOT NULL,
	"clock_at" timestamp with time zone,
	"paused_until" timestamp with time zone,
	"paused_by" uuid,
	"provisioned_txid" bigint DEFAULT txid_current() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "circles_name_present" CHECK (length(trim("circles"."name")) > 0),
	CONSTRAINT "circles_currency_code" CHECK ("circles"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "circles_clock_only_in_demo" CHECK ("circles"."clock_at" is null or "circles"."demo"),
	CONSTRAINT "circles_pause_has_author" CHECK (("circles"."paused_until" is null) = ("circles"."paused_by" is null))
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "circle_role" NOT NULL,
	"invited_by" uuid NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_email_shape" CHECK ("invitations"."email" ~ '^[^@\s]+@[^@\s]+$')
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"user_id" text,
	"display_name" text NOT NULL,
	"role" "circle_role" NOT NULL,
	"parent_level" "parent_level",
	"relationship" text,
	"portrait" text,
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"demo_seat" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "members_one_seat_per_person" UNIQUE("circle_id","user_id"),
	CONSTRAINT "members_demo_seat_has_person" CHECK (not "members"."demo_seat" or "members"."user_id" is not null),
	CONSTRAINT "members_name_present" CHECK (length(trim("members"."display_name")) > 0),
	CONSTRAINT "members_parent_level_only_for_parent" CHECK (("members"."role" = 'parent') = ("members"."parent_level" is not null))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"paypal_payer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_id_present" CHECK (length("users"."id") between 1 and 128)
);
--> statement-breakpoint
CREATE TABLE "agreement_acceptances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"agreement_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"method" "approval_method" NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agreement_acceptances_once" UNIQUE("agreement_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "agreement_shares" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"agreement_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"bps" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "agreement_shares_one_per_member" UNIQUE("agreement_id","member_id"),
	CONSTRAINT "agreement_shares_position" UNIQUE("agreement_id","position"),
	CONSTRAINT "agreement_shares_bps" CHECK ("agreement_shares"."bps" > 0 and "agreement_shares"."bps" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "agreements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"care_rate_cents_per_hour" bigint,
	"care_paid_in_cash" boolean DEFAULT false NOT NULL,
	"ceiling_cents" bigint NOT NULL,
	"second_approval_above_cents" bigint NOT NULL,
	"parent_decides_above_cents" bigint NOT NULL,
	"effective_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreements_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "agreements_one_per_version" UNIQUE("circle_id","version"),
	CONSTRAINT "agreements_version_positive" CHECK ("agreements"."version" > 0),
	CONSTRAINT "agreements_care_rate" CHECK ("agreements"."care_rate_cents_per_hour" is null or "agreements"."care_rate_cents_per_hour" > 0),
	CONSTRAINT "agreements_care_cash_needs_rate" CHECK (not "agreements"."care_paid_in_cash" or "agreements"."care_rate_cents_per_hour" is not null),
	CONSTRAINT "agreements_thresholds" CHECK ("agreements"."parent_decides_above_cents" >= 0 and "agreements"."second_approval_above_cents" >= 0 and "agreements"."ceiling_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"payee_id" uuid NOT NULL,
	"document_id" uuid,
	"amount_cents" bigint NOT NULL,
	"due_on" date,
	"received_on" date NOT NULL,
	"state" "bill_state" DEFAULT 'received' NOT NULL,
	"duplicate_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bills_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "bills_amount_positive" CHECK ("bills"."amount_cents" > 0),
	CONSTRAINT "bills_duplicate_state" CHECK (("bills"."state" = 'duplicate') = ("bills"."duplicate_of" is not null))
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"kind" "document_kind" NOT NULL,
	"storage_key" text,
	"content_type" text,
	"uploaded_by" uuid,
	"extraction" jsonb,
	"confidence" real,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "documents_stored_or_simulated" CHECK ("documents"."storage_key" is not null or "documents"."simulated"),
	CONSTRAINT "documents_confidence_range" CHECK ("documents"."confidence" is null or ("documents"."confidence" >= 0 and "documents"."confidence" <= 1))
);
--> statement-breakpoint
CREATE TABLE "expected_bills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"payee_id" uuid NOT NULL,
	"kind" "proposal_kind" NOT NULL,
	"expected_cents" bigint NOT NULL,
	"due_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expected_bills_once" UNIQUE("circle_id","payee_id","due_on"),
	CONSTRAINT "expected_bills_amount_positive" CHECK ("expected_bills"."expected_cents" > 0),
	CONSTRAINT "expected_bills_kind" CHECK (kind in ('bill_payment', 'caregiver_payout', 'purchase'))
);
--> statement-breakpoint
CREATE TABLE "payees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"status" "payee_status" DEFAULT 'new' NOT NULL,
	"member_id" uuid,
	"paypal_receiver" text,
	"auto_pay_rule_id" text,
	"auto_pay_min_cents" bigint,
	"auto_pay_max_cents" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payees_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "payees_name_present" CHECK (length(trim("payees"."name")) > 0),
	CONSTRAINT "payees_category_code" CHECK ("payees"."category" ~ '^[a-z0-9_-]+$'),
	CONSTRAINT "payees_auto_pay_complete" CHECK (("payees"."auto_pay_rule_id" is null and "payees"."auto_pay_min_cents" is null and "payees"."auto_pay_max_cents" is null)
        or ("payees"."auto_pay_rule_id" is not null and "payees"."auto_pay_min_cents" > 0 and "payees"."auto_pay_max_cents" >= "payees"."auto_pay_min_cents")),
	CONSTRAINT "payees_auto_pay_only_when_approved" CHECK ("payees"."auto_pay_rule_id" is null or "payees"."status" = 'approved')
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"code" text NOT NULL,
	"member_id" uuid,
	"payee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "ledger_accounts_one_per_code" UNIQUE("circle_id","code"),
	CONSTRAINT "ledger_accounts_code_shape" CHECK ("ledger_accounts"."code" ~ '^[a-z_]+(:[A-Za-z0-9_-]+)?$'),
	CONSTRAINT "ledger_accounts_one_owner" CHECK ("ledger_accounts"."member_id" is null or "ledger_accounts"."payee_id" is null)
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "ledger_entries_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" "entry_kind" NOT NULL,
	"occurred_on" date NOT NULL,
	"period" text NOT NULL,
	"description" text NOT NULL,
	"source_type" "entry_source_type" NOT NULL,
	"source_id" text NOT NULL,
	"currency" char(3) NOT NULL,
	"simulated" boolean NOT NULL,
	"reverses" uuid,
	"created_txid" bigint DEFAULT txid_current() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "ledger_entries_one_per_source" UNIQUE("circle_id","source_type","source_id"),
	CONSTRAINT "ledger_entries_reversed_once" UNIQUE("circle_id","reverses"),
	CONSTRAINT "ledger_entries_period_shape" CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "ledger_entries_texts_present" CHECK (length(trim("ledger_entries"."description")) > 0 and length(trim("ledger_entries"."source_id")) > 0),
	CONSTRAINT "ledger_entries_currency_code" CHECK ("ledger_entries"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "ledger_entries_not_self_reversing" CHECK ("ledger_entries"."reverses" is null or "ledger_entries"."reverses" <> "ledger_entries"."id")
);
--> statement-breakpoint
CREATE TABLE "ledger_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"direction" "direction" NOT NULL,
	"cents" bigint NOT NULL,
	CONSTRAINT "ledger_lines_position" UNIQUE("entry_id","position"),
	CONSTRAINT "ledger_lines_cents_positive" CHECK ("ledger_lines"."cents" > 0),
	CONSTRAINT "ledger_lines_position_order" CHECK ("ledger_lines"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "care_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"occurred_on" date NOT NULL,
	"minutes" integer NOT NULL,
	"note" text,
	"approved" boolean DEFAULT false NOT NULL,
	"ledger_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "care_entries_minutes" CHECK ("care_entries"."minutes" > 0 and "care_entries"."minutes" <= 1440),
	CONSTRAINT "care_entries_entry_when_approved" CHECK ("care_entries"."ledger_entry_id" is null or "care_entries"."approved")
);
--> statement-breakpoint
CREATE TABLE "claim_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"checked_on" date NOT NULL,
	"payee_id" uuid,
	"claimed_cents" bigint,
	"claim" text NOT NULL,
	"found_entry_id" uuid,
	"verdict" "claim_verdict" NOT NULL,
	"alerted" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_checks_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "claim_checks_claimed_positive" CHECK ("claim_checks"."claimed_cents" is null or "claim_checks"."claimed_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "narrations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"cents" bigint,
	"entry_id" uuid,
	"claim_check_id" uuid,
	"spoken_text" text,
	"state" "narration_state" DEFAULT 'queued' NOT NULL,
	"said_on" date NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "narrations_topic_key" CHECK ("narrations"."topic" ~ '^[a-zA-Z0-9_-]+$'),
	CONSTRAINT "narrations_delivered" CHECK (("narrations"."state" = 'delivered') = ("narrations"."delivered_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"period" text NOT NULL,
	"agreement_version" integer NOT NULL,
	"inputs" jsonb NOT NULL,
	"fairness" jsonb NOT NULL,
	"plan" jsonb NOT NULL,
	"state" "settlement_state" DEFAULT 'proposed' NOT NULL,
	"calculated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "settlements_period_shape" CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role" "circle_role" NOT NULL,
	"decision" "vote_decision" NOT NULL,
	"method" "approval_method" NOT NULL,
	"evidence_ref" text,
	"decided_at" timestamp with time zone NOT NULL,
	CONSTRAINT "approvals_one_per_member" UNIQUE("proposal_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"state" "execution_state" DEFAULT 'created' NOT NULL,
	"paypal_batch_id" text,
	"paypal_item_id" text,
	"paypal_order_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "executions_idempotency_key" UNIQUE("idempotency_key"),
	CONSTRAINT "executions_attempts" CHECK ("executions"."attempts" >= 0),
	CONSTRAINT "executions_key_present" CHECK (length(trim("executions"."idempotency_key")) > 0)
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"kind" "proposal_kind" NOT NULL,
	"cents" bigint NOT NULL,
	"payee_id" uuid,
	"member_id" uuid,
	"purpose" text NOT NULL,
	"note" text,
	"raised_by" uuid,
	"raised_at" timestamp with time zone NOT NULL,
	"state" "proposal_state" DEFAULT 'proposed' NOT NULL,
	"expires_at" timestamp with time zone,
	"agreement_version" integer NOT NULL,
	"plan" jsonb NOT NULL,
	"bill_id" uuid,
	"settlement_id" uuid,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposals_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "proposals_cents_positive" CHECK ("proposals"."cents" > 0),
	CONSTRAINT "proposals_one_recipient" CHECK (("proposals"."payee_id" is null) <> ("proposals"."member_id" is null)),
	CONSTRAINT "proposals_member_payout_to_member" CHECK (("proposals"."kind" = 'member_payout') = ("proposals"."member_id" is not null)),
	CONSTRAINT "proposals_purpose_key" CHECK ("proposals"."purpose" ~ '^[a-zA-Z0-9_-]+$')
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor" "audit_actor" NOT NULL,
	"member_id" uuid,
	"action" text NOT NULL,
	"subject_type" text,
	"subject_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"origin" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_member_actor" CHECK (("audit_log"."actor" = 'member') = ("audit_log"."member_id" is not null)),
	CONSTRAINT "audit_log_action_key" CHECK ("audit_log"."action" ~ '^[a-z_.]+$')
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_attempts" CHECK ("outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "paypal_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"raw_body" text NOT NULL,
	"headers" jsonb NOT NULL,
	"state" "paypal_event_state" DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "paypal_events_once" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_fk" FOREIGN KEY ("circle_id","invited_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_agreement_fk" FOREIGN KEY ("circle_id","agreement_id") REFERENCES "public"."agreements"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_member_fk" FOREIGN KEY ("circle_id","member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_shares" ADD CONSTRAINT "agreement_shares_agreement_fk" FOREIGN KEY ("circle_id","agreement_id") REFERENCES "public"."agreements"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_shares" ADD CONSTRAINT "agreement_shares_member_fk" FOREIGN KEY ("circle_id","member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_payee_fk" FOREIGN KEY ("circle_id","payee_id") REFERENCES "public"."payees"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_document_fk" FOREIGN KEY ("circle_id","document_id") REFERENCES "public"."documents"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_duplicate_fk" FOREIGN KEY ("circle_id","duplicate_of") REFERENCES "public"."bills"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploader_fk" FOREIGN KEY ("circle_id","uploaded_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expected_bills" ADD CONSTRAINT "expected_bills_payee_fk" FOREIGN KEY ("circle_id","payee_id") REFERENCES "public"."payees"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payees" ADD CONSTRAINT "payees_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payees" ADD CONSTRAINT "payees_member_fk" FOREIGN KEY ("circle_id","member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_member_fk" FOREIGN KEY ("circle_id","member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_payee_fk" FOREIGN KEY ("circle_id","payee_id") REFERENCES "public"."payees"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reverses_fk" FOREIGN KEY ("circle_id","reverses") REFERENCES "public"."ledger_entries"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_entry_fk" FOREIGN KEY ("circle_id","entry_id") REFERENCES "public"."ledger_entries"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_account_fk" FOREIGN KEY ("circle_id","account_id") REFERENCES "public"."ledger_accounts"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_entries" ADD CONSTRAINT "care_entries_member_fk" FOREIGN KEY ("circle_id","member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_entries" ADD CONSTRAINT "care_entries_entry_fk" FOREIGN KEY ("circle_id","ledger_entry_id") REFERENCES "public"."ledger_entries"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_checks" ADD CONSTRAINT "claim_checks_payee_fk" FOREIGN KEY ("circle_id","payee_id") REFERENCES "public"."payees"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_checks" ADD CONSTRAINT "claim_checks_entry_fk" FOREIGN KEY ("circle_id","found_entry_id") REFERENCES "public"."ledger_entries"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrations" ADD CONSTRAINT "narrations_member_fk" FOREIGN KEY ("circle_id","member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrations" ADD CONSTRAINT "narrations_entry_fk" FOREIGN KEY ("circle_id","entry_id") REFERENCES "public"."ledger_entries"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrations" ADD CONSTRAINT "narrations_claim_check_fk" FOREIGN KEY ("circle_id","claim_check_id") REFERENCES "public"."claim_checks"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_proposal_fk" FOREIGN KEY ("circle_id","proposal_id") REFERENCES "public"."proposals"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_member_fk" FOREIGN KEY ("circle_id","member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_proposal_fk" FOREIGN KEY ("circle_id","proposal_id") REFERENCES "public"."proposals"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_payee_fk" FOREIGN KEY ("circle_id","payee_id") REFERENCES "public"."payees"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_member_fk" FOREIGN KEY ("circle_id","member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_raised_by_fk" FOREIGN KEY ("circle_id","raised_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_bill_fk" FOREIGN KEY ("circle_id","bill_id") REFERENCES "public"."bills"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_settlement_fk" FOREIGN KEY ("circle_id","settlement_id") REFERENCES "public"."settlements"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_document_fk" FOREIGN KEY ("circle_id","document_id") REFERENCES "public"."documents"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_member_fk" FOREIGN KEY ("circle_id","member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paypal_events" ADD CONSTRAINT "paypal_events_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "members_user_idx" ON "members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_one_demo_seat" ON "members" USING btree ("user_id") WHERE "members"."demo_seat" and "members"."status" = 'active';--> statement-breakpoint
CREATE INDEX "bills_payee_idx" ON "bills" USING btree ("circle_id","payee_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_period_idx" ON "ledger_entries" USING btree ("circle_id","period");--> statement-breakpoint
CREATE INDEX "ledger_lines_account_idx" ON "ledger_lines" USING btree ("circle_id","account_id");--> statement-breakpoint
CREATE INDEX "proposals_state_idx" ON "proposals" USING btree ("circle_id","state");--> statement-breakpoint
CREATE INDEX "audit_log_circle_idx" ON "audit_log" USING btree ("circle_id","sequence");--> statement-breakpoint
CREATE INDEX "outbox_unsent_idx" ON "outbox" USING btree ("available_at") WHERE "outbox"."sent_at" is null;
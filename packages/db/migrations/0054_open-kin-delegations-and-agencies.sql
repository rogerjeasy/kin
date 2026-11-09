CREATE TABLE "agency_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"label" text NOT NULL,
	"key_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"seeded" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "agency_keys_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "agency_keys_label" CHECK (length(btrim("agency_keys"."label")) between 1 and 80 and "agency_keys"."label" !~ '[<>{}\n\r]'),
	CONSTRAINT "agency_keys_key_shape" CHECK ("agency_keys"."key_id" ~ '^agk_[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "agency_keys_hash" CHECK ("agency_keys"."secret_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "agency_keys_revoked" CHECK (("agency_keys"."revoked_at" is null) = ("agency_keys"."revoked_by" is null))
);
--> statement-breakpoint
CREATE TABLE "agency_visit_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"agency_key_id" uuid NOT NULL,
	"raw_body" text NOT NULL,
	"body_sha256" text NOT NULL,
	"state" text NOT NULL,
	"refusal" text,
	"external_id" text,
	"caregiver_name" text,
	"caregiver_member_id" uuid,
	"kind" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	"checked_out_at" timestamp with time zone,
	"minutes" integer,
	"note" text,
	"seeded" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_visit_reports_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "agency_visit_reports_body" CHECK (length("agency_visit_reports"."raw_body") between 1 and 16384),
	CONSTRAINT "agency_visit_reports_sha" CHECK ("agency_visit_reports"."body_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "agency_visit_reports_state" CHECK (state in ('accepted', 'refused')),
	CONSTRAINT "agency_visit_reports_kind" CHECK (kind is null or kind in ('aide', 'visit', 'appointment', 'drive')),
	CONSTRAINT "agency_visit_reports_accepted" CHECK (("agency_visit_reports"."state" = 'accepted') = ("agency_visit_reports"."refusal" is null)
        and ("agency_visit_reports"."state" = 'refused' or ("agency_visit_reports"."external_id" is not null and "agency_visit_reports"."caregiver_name" is not null and "agency_visit_reports"."kind" is not null and "agency_visit_reports"."starts_at" is not null and "agency_visit_reports"."ends_at" is not null and "agency_visit_reports"."minutes" is not null))
        and ("agency_visit_reports"."state" = 'accepted' or ("agency_visit_reports"."external_id" is null and "agency_visit_reports"."caregiver_member_id" is null))),
	CONSTRAINT "agency_visit_reports_refusal" CHECK (refusal is null or refusal in ('shape', 'times')),
	CONSTRAINT "agency_visit_reports_minutes" CHECK ("agency_visit_reports"."minutes" is null or "agency_visit_reports"."minutes" between 1 and 1440),
	CONSTRAINT "agency_visit_reports_times" CHECK ("agency_visit_reports"."ends_at" is null or "agency_visit_reports"."ends_at" > "agency_visit_reports"."starts_at"),
	CONSTRAINT "agency_visit_reports_note" CHECK ("agency_visit_reports"."note" is null or (length("agency_visit_reports"."note") <= 280 and "agency_visit_reports"."note" !~ '[<>{}\n\r]'))
);
--> statement-breakpoint
CREATE TABLE "delegation_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"delegation_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"outcome" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"proposal_id" uuid,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "delegation_calls_tool" CHECK ("delegation_calls"."tool" ~ '^([A-Za-z0-9_.-]{1,64}|\[unreadable\])$'),
	CONSTRAINT "delegation_calls_outcome" CHECK (outcome in ('ok', 'unknown_tool', 'refused', 'invalid', 'limit', 'failed', 'timeout', 'too_large')),
	CONSTRAINT "delegation_calls_duration" CHECK ("delegation_calls"."duration_ms" between 0 and 600000),
	CONSTRAINT "delegation_calls_proposal_only_ok" CHECK ("delegation_calls"."proposal_id" is null or "delegation_calls"."outcome" = 'ok')
);
--> statement-breakpoint
CREATE TABLE "delegations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"label" text NOT NULL,
	"scope" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_hint" text NOT NULL,
	"console" boolean DEFAULT false NOT NULL,
	"seeded" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"last_used_at" timestamp with time zone,
	"uses" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delegations_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "delegations_scope" CHECK (scope in ('read', 'propose')),
	CONSTRAINT "delegations_label" CHECK (length(btrim("delegations"."label")) between 1 and 60 and "delegations"."label" !~ '[<>{}\n\r]'),
	CONSTRAINT "delegations_hash" CHECK ("delegations"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "delegations_hint" CHECK ("delegations"."token_hint" ~ '^[A-Za-z0-9_-]{4}$'),
	CONSTRAINT "delegations_expiry" CHECK ("delegations"."expires_at" > "delegations"."created_at"),
	CONSTRAINT "delegations_revoked" CHECK (("delegations"."revoked_at" is null) = ("delegations"."revoked_by" is null)),
	CONSTRAINT "delegations_uses" CHECK ("delegations"."uses" >= 0)
);
--> statement-breakpoint
ALTER TABLE "agency_keys" ADD CONSTRAINT "agency_keys_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_keys" ADD CONSTRAINT "agency_keys_created_by_fk" FOREIGN KEY ("circle_id","created_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_keys" ADD CONSTRAINT "agency_keys_revoked_by_fk" FOREIGN KEY ("circle_id","revoked_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_visit_reports" ADD CONSTRAINT "agency_visit_reports_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_visit_reports" ADD CONSTRAINT "agency_visit_reports_key_fk" FOREIGN KEY ("circle_id","agency_key_id") REFERENCES "public"."agency_keys"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_visit_reports" ADD CONSTRAINT "agency_visit_reports_caregiver_fk" FOREIGN KEY ("circle_id","caregiver_member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_calls" ADD CONSTRAINT "delegation_calls_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_calls" ADD CONSTRAINT "delegation_calls_delegation_fk" FOREIGN KEY ("circle_id","delegation_id") REFERENCES "public"."delegations"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_calls" ADD CONSTRAINT "delegation_calls_proposal_fk" FOREIGN KEY ("circle_id","proposal_id") REFERENCES "public"."proposals"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_member_fk" FOREIGN KEY ("circle_id","member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_revoked_by_fk" FOREIGN KEY ("circle_id","revoked_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agency_keys_key_id" ON "agency_keys" USING btree ("key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agency_visit_reports_external" ON "agency_visit_reports" USING btree ("agency_key_id","external_id") WHERE "agency_visit_reports"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "agency_visit_reports_received_idx" ON "agency_visit_reports" USING btree ("circle_id","received_at");--> statement-breakpoint
CREATE INDEX "delegation_calls_delegation_idx" ON "delegation_calls" USING btree ("circle_id","delegation_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "delegations_token" ON "delegations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "delegations_member_idx" ON "delegations" USING btree ("circle_id","member_id");
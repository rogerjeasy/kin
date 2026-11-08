CREATE TABLE "parent_call_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"consented_by" uuid,
	"consented_at" timestamp with time zone,
	"quiet_start" time DEFAULT '21:00' NOT NULL,
	"quiet_end" time DEFAULT '08:00' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parent_call_settings_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "parent_call_settings_one_per_circle" UNIQUE("circle_id"),
	CONSTRAINT "parent_call_settings_phone" CHECK ("parent_call_settings"."phone" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "parent_call_settings_locale" CHECK ("parent_call_settings"."locale" ~ '^[a-z]{2}(-[A-Z]{2})?$'),
	CONSTRAINT "parent_call_settings_consent_whole" CHECK (("parent_call_settings"."consented_at" is null) = ("parent_call_settings"."consented_by" is null)),
	CONSTRAINT "parent_call_settings_enabled_has_consent" CHECK (not "parent_call_settings"."enabled" or "parent_call_settings"."consented_at" is not null),
	CONSTRAINT "parent_call_settings_quiet_hours" CHECK ("parent_call_settings"."quiet_start" <> "parent_call_settings"."quiet_end")
);
--> statement-breakpoint
CREATE TABLE "shift_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"call_sid" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "shift_calls_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "shift_calls_attempt" UNIQUE("circle_id","shift_id","attempt"),
	CONSTRAINT "shift_calls_state" CHECK (state in ('queued', 'calling', 'answered', 'confirmed', 'declined', 'no_answer', 'failed')),
	CONSTRAINT "shift_calls_attempt_range" CHECK (attempt between 1 and 2),
	CONSTRAINT "shift_calls_sid_shape" CHECK ("shift_calls"."call_sid" is null or "shift_calls"."call_sid" ~ '^[A-Za-z0-9]{1,64}$'),
	CONSTRAINT "shift_calls_error_short" CHECK ("shift_calls"."last_error" is null or length("shift_calls"."last_error") <= 200),
	CONSTRAINT "shift_calls_placed_has_sid" CHECK ("shift_calls"."state" in ('queued', 'failed') or "shift_calls"."call_sid" is not null),
	CONSTRAINT "shift_calls_ended_when_over" CHECK (("shift_calls"."state" in ('confirmed', 'declined', 'no_answer', 'failed')) = ("shift_calls"."ended_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "shift_check_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"window_started_at" timestamp with time zone,
	"window_uses" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "shift_check_links_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "shift_check_links_token" UNIQUE("token_hash"),
	CONSTRAINT "shift_check_links_hash" CHECK ("shift_check_links"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "shift_check_links_expiry" CHECK ("shift_check_links"."expires_at" > "shift_check_links"."created_at"),
	CONSTRAINT "shift_check_links_counts" CHECK ("shift_check_links"."uses" >= 0 and "shift_check_links"."window_uses" >= 0)
);
--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "family_evidence_ref" text;--> statement-breakpoint
-- The foreign key of shift_check_links to a shift and its member needs this key first.
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_circle_row_member" UNIQUE("circle_id","id","member_id");--> statement-breakpoint
ALTER TABLE "parent_call_settings" ADD CONSTRAINT "parent_call_settings_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_call_settings" ADD CONSTRAINT "parent_call_settings_member_fk" FOREIGN KEY ("circle_id","member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_call_settings" ADD CONSTRAINT "parent_call_settings_consented_by_fk" FOREIGN KEY ("circle_id","consented_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_calls" ADD CONSTRAINT "shift_calls_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_calls" ADD CONSTRAINT "shift_calls_shift_fk" FOREIGN KEY ("circle_id","shift_id") REFERENCES "public"."shifts"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_check_links" ADD CONSTRAINT "shift_check_links_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_check_links" ADD CONSTRAINT "shift_check_links_shift_fk" FOREIGN KEY ("circle_id","shift_id","member_id") REFERENCES "public"."shifts"("circle_id","id","member_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_check_links" ADD CONSTRAINT "shift_check_links_created_by_fk" FOREIGN KEY ("circle_id","created_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shift_calls_sid" ON "shift_calls" USING btree ("circle_id","call_sid") WHERE "shift_calls"."call_sid" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "shift_calls_one_active" ON "shift_calls" USING btree ("circle_id","shift_id") WHERE "shift_calls"."state" in ('queued', 'calling', 'answered');--> statement-breakpoint
CREATE INDEX "shift_calls_shift_idx" ON "shift_calls" USING btree ("circle_id","shift_id");--> statement-breakpoint
CREATE INDEX "shift_check_links_shift_idx" ON "shift_check_links" USING btree ("circle_id","shift_id","expires_at");--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_evidence_with_word" CHECK ("shifts"."family_evidence_ref" is null or ("shifts"."family_confirmed_at" is not null and length("shifts"."family_evidence_ref") between 1 and 100));
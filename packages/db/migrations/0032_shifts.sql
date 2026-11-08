CREATE TYPE "public"."shift_state" AS ENUM('scheduled', 'checked_in', 'checked_out', 'confirmed', 'priced', 'paid', 'cancelled');--> statement-breakpoint
CREATE TABLE "shift_permission_uses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"cents" bigint NOT NULL,
	"minutes" integer NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_permission_uses_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "shift_permission_uses_one_per_proposal" UNIQUE("circle_id","proposal_id"),
	CONSTRAINT "shift_permission_uses_one_per_shift" UNIQUE("circle_id","shift_id"),
	CONSTRAINT "shift_permission_uses_amounts" CHECK (cents > 0 and minutes between 1 and 1440)
);
--> statement-breakpoint
CREATE TABLE "shift_permissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"payee_id" uuid NOT NULL,
	"granted_by" uuid NOT NULL,
	"recorded_by" uuid NOT NULL,
	"max_minutes_per_day" integer NOT NULL,
	"per_shift_cents" bigint NOT NULL,
	"valid_from" date NOT NULL,
	"expires_on" date NOT NULL,
	"status" "mandate_status" DEFAULT 'active' NOT NULL,
	"spoken_text" text,
	"evidence_ref" text NOT NULL,
	"simulated" boolean NOT NULL,
	"digest" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_permissions_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "shift_permissions_caps" CHECK (per_shift_cents > 0 and per_shift_cents <= 9007199254740991 and max_minutes_per_day between 1 and 1440),
	CONSTRAINT "shift_permissions_dates" CHECK ("shift_permissions"."expires_on" > "shift_permissions"."valid_from" and "shift_permissions"."expires_on" - "shift_permissions"."valid_from" <= 366),
	CONSTRAINT "shift_permissions_ended_when_revoked" CHECK (("shift_permissions"."status" = 'revoked') = ("shift_permissions"."ended_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"member_id" uuid NOT NULL,
	"payee_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"state" "shift_state" DEFAULT 'scheduled' NOT NULL,
	"checked_in_at" timestamp with time zone,
	"checked_out_at" timestamp with time zone,
	"family_confirmed_by" uuid,
	"family_confirmed_at" timestamp with time zone,
	"family_confirmation" text,
	"worked_minutes" integer,
	"billable_minutes" integer,
	"rate_cents_per_hour" bigint,
	"cents" bigint,
	"proposal_id" uuid,
	"permission_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shifts_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "shifts_one_per_proposal" UNIQUE("circle_id","proposal_id"),
	CONSTRAINT "shifts_kind" CHECK (kind in ('aide', 'visit', 'appointment', 'drive')),
	CONSTRAINT "shifts_title" CHECK ("shifts"."title" is null or length(trim("shifts"."title")) between 1 and 120),
	CONSTRAINT "shifts_planned_span" CHECK ("shifts"."ends_at" > "shifts"."starts_at" and "shifts"."ends_at" - "shifts"."starts_at" <= interval '24 hours'),
	CONSTRAINT "shifts_aide_has_payee" CHECK (("shifts"."kind" = 'aide') = ("shifts"."payee_id" is not null)),
	CONSTRAINT "shifts_taps_in_order" CHECK (("shifts"."checked_out_at" is null or ("shifts"."checked_in_at" is not null and "shifts"."checked_out_at" > "shifts"."checked_in_at"))),
	CONSTRAINT "shifts_family_word_whole" CHECK (("shifts"."family_confirmed_at" is null) = ("shifts"."family_confirmed_by" is null) and ("shifts"."family_confirmed_at" is null) = ("shifts"."family_confirmation" is null) and ("shifts"."family_confirmation" is null or "shifts"."family_confirmation" in ('parent', 'sibling'))),
	CONSTRAINT "shifts_state_matches_keys" CHECK (("shifts"."state" <> 'scheduled' or ("shifts"."checked_in_at" is null and "shifts"."family_confirmed_at" is null))
        and ("shifts"."state" <> 'checked_in' or ("shifts"."checked_in_at" is not null and "shifts"."checked_out_at" is null))
        and ("shifts"."state" <> 'checked_out' or ("shifts"."checked_out_at" is not null and "shifts"."family_confirmed_at" is null))
        and ("shifts"."state" not in ('confirmed', 'priced', 'paid') or ("shifts"."checked_out_at" is not null and "shifts"."family_confirmed_at" is not null))),
	CONSTRAINT "shifts_priced_has_proposal" CHECK (("shifts"."state" in ('priced', 'paid')) = ("shifts"."proposal_id" is not null and "shifts"."cents" is not null and "shifts"."worked_minutes" is not null and "shifts"."billable_minutes" is not null and "shifts"."rate_cents_per_hour" is not null)),
	CONSTRAINT "shifts_permission_needs_proposal" CHECK ("shifts"."permission_id" is null or "shifts"."proposal_id" is not null),
	CONSTRAINT "shifts_price_in_range" CHECK ((cents is null or (cents > 0 and cents <= 9007199254740991)) and (rate_cents_per_hour is null or rate_cents_per_hour > 0) and (worked_minutes is null or worked_minutes between 1 and 1440) and (billable_minutes is null or billable_minutes between worked_minutes and 1440))
);
--> statement-breakpoint
ALTER TABLE "payees" ADD COLUMN "payout_wallet" text DEFAULT 'paypal' NOT NULL;--> statement-breakpoint
ALTER TABLE "payees" ADD COLUMN "shift_minimum_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payees" ADD COLUMN "shift_overtime_after_minutes" integer;--> statement-breakpoint
ALTER TABLE "payees" ADD COLUMN "shift_overtime_percent" integer DEFAULT 150 NOT NULL;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "wallet" text DEFAULT 'paypal' NOT NULL;--> statement-breakpoint
ALTER TABLE "shift_permission_uses" ADD CONSTRAINT "shift_permission_uses_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_permission_uses" ADD CONSTRAINT "shift_permission_uses_permission_fk" FOREIGN KEY ("circle_id","permission_id") REFERENCES "public"."shift_permissions"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_permission_uses" ADD CONSTRAINT "shift_permission_uses_shift_fk" FOREIGN KEY ("circle_id","shift_id") REFERENCES "public"."shifts"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_permission_uses" ADD CONSTRAINT "shift_permission_uses_proposal_fk" FOREIGN KEY ("circle_id","proposal_id") REFERENCES "public"."proposals"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_permissions" ADD CONSTRAINT "shift_permissions_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_permissions" ADD CONSTRAINT "shift_permissions_payee_fk" FOREIGN KEY ("circle_id","payee_id") REFERENCES "public"."payees"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_permissions" ADD CONSTRAINT "shift_permissions_granted_by_fk" FOREIGN KEY ("circle_id","granted_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_permissions" ADD CONSTRAINT "shift_permissions_recorded_by_fk" FOREIGN KEY ("circle_id","recorded_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_member_fk" FOREIGN KEY ("circle_id","member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_payee_fk" FOREIGN KEY ("circle_id","payee_id") REFERENCES "public"."payees"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_confirmed_by_fk" FOREIGN KEY ("circle_id","family_confirmed_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_created_by_fk" FOREIGN KEY ("circle_id","created_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_proposal_fk" FOREIGN KEY ("circle_id","proposal_id") REFERENCES "public"."proposals"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_permission_fk" FOREIGN KEY ("circle_id","permission_id") REFERENCES "public"."shift_permissions"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shift_permission_uses_day_idx" ON "shift_permission_uses" USING btree ("circle_id","permission_id","day");--> statement-breakpoint
CREATE INDEX "shift_permissions_payee_idx" ON "shift_permissions" USING btree ("circle_id","payee_id");--> statement-breakpoint
CREATE INDEX "shifts_starts_idx" ON "shifts" USING btree ("circle_id","starts_at");--> statement-breakpoint
CREATE INDEX "shifts_member_idx" ON "shifts" USING btree ("circle_id","member_id");--> statement-breakpoint
ALTER TABLE "payees" ADD CONSTRAINT "payees_payout_wallet" CHECK (payout_wallet in ('paypal', 'venmo'));--> statement-breakpoint
ALTER TABLE "payees" ADD CONSTRAINT "payees_shift_rules" CHECK (shift_minimum_minutes between 0 and 1440 and shift_overtime_percent between 100 and 300 and (shift_overtime_after_minutes is null or shift_overtime_after_minutes between 1 and 1440));--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_wallet" CHECK (wallet in ('paypal', 'venmo'));
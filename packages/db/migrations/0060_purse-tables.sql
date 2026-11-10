ALTER TYPE "public"."entry_kind" ADD VALUE 'purse_funded';--> statement-breakpoint
ALTER TYPE "public"."entry_kind" ADD VALUE 'purse_paid';--> statement-breakpoint
CREATE TABLE "purse_payees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"kind" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"paypal_receiver" text NOT NULL,
	"added_by" uuid NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"simulated" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purse_payees_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "purse_payees_name" CHECK (length(btrim("purse_payees"."name")) between 1 and 80),
	CONSTRAINT "purse_payees_relationship" CHECK (length(btrim("purse_payees"."relationship")) between 1 and 80),
	CONSTRAINT "purse_payees_kind" CHECK (kind in ('person', 'charity', 'shop')),
	CONSTRAINT "purse_payees_aliases" CHECK (cardinality("purse_payees"."aliases") <= 5 and length(array_to_string("purse_payees"."aliases", '')) <= 200),
	CONSTRAINT "purse_payees_receiver" CHECK ("purse_payees"."paypal_receiver" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and length("purse_payees"."paypal_receiver") <= 254),
	CONSTRAINT "purse_payees_verified" CHECK (("purse_payees"."verified_by" is null) = ("purse_payees"."verified_at" is null) and ("purse_payees"."verified_by" is null or "purse_payees"."verified_by" <> "purse_payees"."added_by"))
);
--> statement-breakpoint
CREATE TABLE "purse_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"purse_id" uuid NOT NULL,
	"payee_id" uuid,
	"payee_name" text NOT NULL,
	"cents" bigint NOT NULL,
	"memo" text,
	"words" text NOT NULL,
	"route" text,
	"markers" text[] DEFAULT '{}' NOT NULL,
	"hold_reasons" text[] DEFAULT '{}' NOT NULL,
	"read_back" text NOT NULL,
	"read_back_source" text NOT NULL,
	"state" text DEFAULT 'proposed' NOT NULL,
	"proposed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"answer_method" text,
	"answer_evidence" text,
	"held_at" timestamp with time zone,
	"hold_ends_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"pressured" boolean DEFAULT false NOT NULL,
	"shared_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"receiver" text,
	"paypal_batch_id" text,
	"paypal_item_id" text,
	"fee_cents" bigint,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"submitted_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"reconciled_at" timestamp with time zone,
	"simulated" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purse_payments_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "purse_payments_key" UNIQUE("idempotency_key"),
	CONSTRAINT "purse_payments_cents" CHECK ("purse_payments"."cents" > 0),
	CONSTRAINT "purse_payments_state" CHECK (state in ('proposed', 'held', 'approved', 'executing', 'unknown', 'paid', 'failed', 'declined', 'expired', 'cancelled')),
	CONSTRAINT "purse_payments_route" CHECK (route is null or route in ('paypal', 'gift_card', 'crypto', 'wire', 'cash', 'unknown')),
	CONSTRAINT "purse_payments_reasons" CHECK (hold_reasons <@ array['new_payee', 'risky_route', 'above_cap', 'pressure']::text[]),
	CONSTRAINT "purse_payments_texts" CHECK (length(btrim(payee_name)) between 1 and 80 and length(words) between 1 and 400 and (memo is null or length(memo) between 1 and 120) and length(read_back) between 1 and 600),
	CONSTRAINT "purse_payments_read_back_source" CHECK ("purse_payments"."read_back_source" in ('model', 'template')),
	CONSTRAINT "purse_payments_answer" CHECK (("purse_payments"."answered_at" is null) = ("purse_payments"."answer_method" is null) and ("purse_payments"."answer_method" is null or "purse_payments"."answer_method" in ('app', 'voice'))),
	CONSTRAINT "purse_payments_hold" CHECK (("purse_payments"."held_at" is null) = ("purse_payments"."hold_ends_at" is null) and ("purse_payments"."held_at" is null or cardinality("purse_payments"."hold_reasons") > 0)),
	CONSTRAINT "purse_payments_cancelled" CHECK (("purse_payments"."cancelled_at" is null) = ("purse_payments"."cancelled_by" is null) and (not "purse_payments"."pressured" or "purse_payments"."cancelled_at" is not null)),
	CONSTRAINT "purse_payments_paid" CHECK (("purse_payments"."state" = 'paid') = ("purse_payments"."paid_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "purses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"parent_member_id" uuid NOT NULL,
	"weekly_cents" bigint NOT NULL,
	"ceiling_cents" bigint NOT NULL,
	"per_payment_cents" bigint NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"set_by" uuid NOT NULL,
	"set_at" timestamp with time zone NOT NULL,
	"simulated" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purses_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "purses_one_per_circle" UNIQUE("circle_id"),
	CONSTRAINT "purses_status" CHECK (status in ('active', 'paused', 'revoked')),
	CONSTRAINT "purses_terms" CHECK ("purses"."weekly_cents" > 0 and "purses"."ceiling_cents" > 0 and "purses"."per_payment_cents" > 0 and "purses"."weekly_cents" <= "purses"."ceiling_cents" and "purses"."per_payment_cents" <= "purses"."ceiling_cents")
);
--> statement-breakpoint
ALTER TABLE "purse_payees" ADD CONSTRAINT "purse_payees_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purse_payees" ADD CONSTRAINT "purse_payees_added_by_fk" FOREIGN KEY ("circle_id","added_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purse_payees" ADD CONSTRAINT "purse_payees_verified_by_fk" FOREIGN KEY ("circle_id","verified_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purse_payments" ADD CONSTRAINT "purse_payments_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purse_payments" ADD CONSTRAINT "purse_payments_purse_fk" FOREIGN KEY ("circle_id","purse_id") REFERENCES "public"."purses"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purse_payments" ADD CONSTRAINT "purse_payments_payee_fk" FOREIGN KEY ("circle_id","payee_id") REFERENCES "public"."purse_payees"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purse_payments" ADD CONSTRAINT "purse_payments_cancelled_by_fk" FOREIGN KEY ("circle_id","cancelled_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purses" ADD CONSTRAINT "purses_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purses" ADD CONSTRAINT "purses_parent_fk" FOREIGN KEY ("circle_id","parent_member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purses" ADD CONSTRAINT "purses_set_by_fk" FOREIGN KEY ("circle_id","set_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purse_payees_one_name" ON "purse_payees" USING btree ("circle_id",lower("name")) WHERE "purse_payees"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "purse_payments_state_idx" ON "purse_payments" USING btree ("circle_id","state");
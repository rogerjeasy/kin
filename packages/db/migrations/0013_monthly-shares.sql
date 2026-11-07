CREATE TYPE "public"."monthly_share_state" AS ENUM('approval_pending', 'active', 'paused', 'cancelled');--> statement-breakpoint
CREATE TABLE "monthly_shares" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"state" "monthly_share_state" DEFAULT 'approval_pending' NOT NULL,
	"paypal_subscription_id" text,
	"approval_url" text,
	"simulated" boolean DEFAULT false NOT NULL,
	"failed_payments" integer DEFAULT 0 NOT NULL,
	"next_billing_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_shares_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "monthly_shares_paypal_once" UNIQUE("paypal_subscription_id"),
	CONSTRAINT "monthly_shares_amount_positive" CHECK ("monthly_shares"."amount_cents" > 0 and "monthly_shares"."amount_cents" <= 9007199254740991),
	CONSTRAINT "monthly_shares_simulated_has_no_paypal" CHECK ("monthly_shares"."simulated" = ("monthly_shares"."paypal_subscription_id" is null)),
	CONSTRAINT "monthly_shares_failed_count" CHECK ("monthly_shares"."failed_payments" >= 0)
);
--> statement-breakpoint
ALTER TABLE "monthly_shares" ADD CONSTRAINT "monthly_shares_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_shares" ADD CONSTRAINT "monthly_shares_member_fk" FOREIGN KEY ("circle_id","member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_shares_one_live" ON "monthly_shares" USING btree ("circle_id","member_id") WHERE "monthly_shares"."state" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "monthly_shares_member_idx" ON "monthly_shares" USING btree ("circle_id","member_id");
CREATE TYPE "public"."mandate_status" AS ENUM('active', 'paused', 'revoked');--> statement-breakpoint
ALTER TYPE "public"."approval_method" ADD VALUE 'mandate';--> statement-breakpoint
CREATE TABLE "mandate_uses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"mandate_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"cents" bigint NOT NULL,
	"period" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mandate_uses_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "mandate_uses_one_per_proposal" UNIQUE("circle_id","proposal_id"),
	CONSTRAINT "mandate_uses_cents_positive" CHECK ("mandate_uses"."cents" > 0),
	CONSTRAINT "mandate_uses_period" CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "mandates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"granted_by" uuid NOT NULL,
	"recorded_by" uuid NOT NULL,
	"per_purchase_cents" bigint NOT NULL,
	"per_period_cents" bigint NOT NULL,
	"cadence" text NOT NULL,
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
	CONSTRAINT "mandates_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "mandates_caps" CHECK ("mandates"."per_purchase_cents" > 0 and "mandates"."per_period_cents" >= "mandates"."per_purchase_cents"),
	CONSTRAINT "mandates_cadence" CHECK ("mandates"."cadence" in ('monthly', 'as_needed')),
	CONSTRAINT "mandates_dates" CHECK ("mandates"."expires_on" > "mandates"."valid_from" and "mandates"."expires_on" - "mandates"."valid_from" <= 366),
	CONSTRAINT "mandates_ended_when_revoked" CHECK (("mandates"."status" = 'revoked') = ("mandates"."ended_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "mandate_uses" ADD CONSTRAINT "mandate_uses_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandate_uses" ADD CONSTRAINT "mandate_uses_mandate_fk" FOREIGN KEY ("circle_id","mandate_id") REFERENCES "public"."mandates"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandate_uses" ADD CONSTRAINT "mandate_uses_proposal_fk" FOREIGN KEY ("circle_id","proposal_id") REFERENCES "public"."proposals"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_rule_fk" FOREIGN KEY ("circle_id","rule_id") REFERENCES "public"."purchase_rules"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_granted_by_fk" FOREIGN KEY ("circle_id","granted_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_recorded_by_fk" FOREIGN KEY ("circle_id","recorded_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mandate_uses_period_idx" ON "mandate_uses" USING btree ("circle_id","mandate_id","period");--> statement-breakpoint
CREATE INDEX "mandates_rule_idx" ON "mandates" USING btree ("circle_id","rule_id");
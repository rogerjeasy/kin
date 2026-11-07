CREATE TYPE "public"."delivery_state" AS ENUM('awaiting', 'ordered', 'shipped', 'out_for_delivery', 'delivered');--> statement-breakpoint
CREATE TABLE "purchase_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"payee_id" uuid NOT NULL,
	"item" text NOT NULL,
	"category" text NOT NULL,
	"price_cents" bigint NOT NULL,
	"limit_cents" bigint NOT NULL,
	"monthly_budget_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_rules_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "purchase_rules_amounts" CHECK ("purchase_rules"."price_cents" > 0 and "purchase_rules"."limit_cents" > 0 and "purchase_rules"."monthly_budget_cents" > 0),
	CONSTRAINT "purchase_rules_texts_present" CHECK (length(trim("purchase_rules"."item")) > 0 and "purchase_rules"."category" ~ '^[a-zA-Z0-9_-]+$')
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"item" text NOT NULL,
	"cents" bigint NOT NULL,
	"state" "delivery_state" DEFAULT 'awaiting' NOT NULL,
	"merchant_order" text,
	"ordered_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "purchases_one_per_proposal" UNIQUE("circle_id","proposal_id"),
	CONSTRAINT "purchases_cents_positive" CHECK ("purchases"."cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "purchase_rules" ADD CONSTRAINT "purchase_rules_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_rules" ADD CONSTRAINT "purchase_rules_payee_fk" FOREIGN KEY ("circle_id","payee_id") REFERENCES "public"."payees"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_rule_fk" FOREIGN KEY ("circle_id","rule_id") REFERENCES "public"."purchase_rules"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_proposal_fk" FOREIGN KEY ("circle_id","proposal_id") REFERENCES "public"."proposals"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchases_rule_idx" ON "purchases" USING btree ("circle_id","rule_id");
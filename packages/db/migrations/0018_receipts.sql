CREATE TYPE "public"."receipt_state" AS ENUM('submitted', 'approved', 'rejected', 'credited');--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"category" text NOT NULL,
	"cents" bigint NOT NULL,
	"description" text NOT NULL,
	"spent_on" date NOT NULL,
	"state" "receipt_state" DEFAULT 'submitted' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "receipts_cents_range" CHECK (cents > 0 and cents <= 10000000),
	CONSTRAINT "receipts_category" CHECK (category in ('pharmacy', 'groceries', 'medical', 'household', 'transport', 'other')),
	CONSTRAINT "receipts_description" CHECK (length(trim(description)) > 0 and length(description) <= 120),
	CONSTRAINT "receipts_decided_by_another" CHECK ("receipts"."decided_by" is null or "receipts"."decided_by" <> "receipts"."member_id"),
	CONSTRAINT "receipts_decision_recorded" CHECK (("receipts"."state" = 'submitted') = ("receipts"."decided_by" is null)),
	CONSTRAINT "receipts_credited_has_entry" CHECK (("receipts"."state" = 'credited') = ("receipts"."entry_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_member_fk" FOREIGN KEY ("circle_id","member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_decided_by_fk" FOREIGN KEY ("circle_id","decided_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipts_state_idx" ON "receipts" USING btree ("circle_id","state");
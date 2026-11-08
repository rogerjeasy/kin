CREATE TYPE "public"."invoice_purpose" AS ENUM('settlement', 'top_up');--> statement-breakpoint
CREATE TYPE "public"."invoice_request_state" AS ENUM('requested', 'sent', 'paid', 'cancelled', 'failed');--> statement-breakpoint
CREATE TABLE "invoice_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"purpose" "invoice_purpose" NOT NULL,
	"period" text,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"state" "invoice_request_state" DEFAULT 'requested' NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"recipient" text,
	"paypal_invoice_id" text,
	"invoice_number" text,
	"payer_url" text,
	"payment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	CONSTRAINT "invoice_requests_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "invoice_requests_paypal_once" UNIQUE("paypal_invoice_id"),
	CONSTRAINT "invoice_requests_payment_once" UNIQUE("circle_id","payment_id"),
	CONSTRAINT "invoice_requests_amount_positive" CHECK ("invoice_requests"."amount_cents" > 0 and "invoice_requests"."amount_cents" <= 9007199254740991),
	CONSTRAINT "invoice_requests_period" CHECK (("invoice_requests"."purpose" = 'settlement') = ("invoice_requests"."period" is not null) and ("invoice_requests"."period" is null or period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')),
	CONSTRAINT "invoice_requests_simulated_has_no_paypal" CHECK (not "invoice_requests"."simulated" or ("invoice_requests"."recipient" is null and "invoice_requests"."paypal_invoice_id" is null)),
	CONSTRAINT "invoice_requests_real_has_recipient" CHECK ("invoice_requests"."simulated" or "invoice_requests"."recipient" is not null),
	CONSTRAINT "invoice_requests_sent_has_invoice" CHECK ("invoice_requests"."state" not in ('sent', 'paid') or "invoice_requests"."simulated" or "invoice_requests"."paypal_invoice_id" is not null),
	CONSTRAINT "invoice_requests_paid_has_payment" CHECK (("invoice_requests"."state" = 'paid') = ("invoice_requests"."payment_id" is not null and "invoice_requests"."paid_at" is not null)),
	CONSTRAINT "invoice_requests_not_to_oneself" CHECK ("invoice_requests"."member_id" <> "invoice_requests"."requested_by")
);
--> statement-breakpoint
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_member_fk" FOREIGN KEY ("circle_id","member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_requester_fk" FOREIGN KEY ("circle_id","requested_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_requests_one_open" ON "invoice_requests" USING btree ("circle_id","member_id","purpose") WHERE "invoice_requests"."state" in ('requested', 'sent');--> statement-breakpoint
CREATE INDEX "invoice_requests_member_idx" ON "invoice_requests" USING btree ("circle_id","member_id");
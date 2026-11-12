CREATE TABLE "agency_invoice_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"visit_report_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	CONSTRAINT "agency_invoice_lines_position" UNIQUE("invoice_id","position"),
	CONSTRAINT "agency_invoice_lines_visit_once" UNIQUE("invoice_id","visit_report_id"),
	CONSTRAINT "agency_invoice_lines_position_range" CHECK ("agency_invoice_lines"."position" between 1 and 100),
	CONSTRAINT "agency_invoice_lines_minutes" CHECK ("agency_invoice_lines"."minutes" between 1 and 1440),
	CONSTRAINT "agency_invoice_lines_amount" CHECK ("agency_invoice_lines"."amount_cents" > 0 and "agency_invoice_lines"."amount_cents" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "agency_invoiced_visits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"visit_report_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "agency_invoiced_visits_once" UNIQUE("invoice_id","visit_report_id")
);
--> statement-breakpoint
CREATE TABLE "agency_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"agency_key_id" uuid NOT NULL,
	"raw_body" text NOT NULL,
	"body_sha256" text NOT NULL,
	"state" text NOT NULL,
	"refusal" text,
	"invoice_number" text,
	"period_start" date,
	"period_end" date,
	"total_cents" bigint,
	"currency" text,
	"due_on" date,
	"paypal_email" text,
	"bill_id" uuid,
	"seeded" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_invoices_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "agency_invoices_body" CHECK (length("agency_invoices"."raw_body") between 1 and 65536),
	CONSTRAINT "agency_invoices_sha" CHECK ("agency_invoices"."body_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "agency_invoices_state" CHECK (state in ('accepted', 'refused')),
	CONSTRAINT "agency_invoices_refusal" CHECK (refusal is null or refusal in ('shape', 'total', 'currency', 'duplicate_line', 'period', 'unknown_visit', 'visit_invoiced', 'circle_currency')),
	CONSTRAINT "agency_invoices_accepted" CHECK (("agency_invoices"."state" = 'accepted') = ("agency_invoices"."refusal" is null)
        and ("agency_invoices"."state" = 'refused' or ("agency_invoices"."invoice_number" is not null and "agency_invoices"."period_start" is not null and "agency_invoices"."period_end" is not null and "agency_invoices"."total_cents" is not null and "agency_invoices"."currency" is not null and "agency_invoices"."due_on" is not null and "agency_invoices"."bill_id" is not null))
        and ("agency_invoices"."state" = 'accepted' or ("agency_invoices"."invoice_number" is null and "agency_invoices"."bill_id" is null and "agency_invoices"."paypal_email" is null))),
	CONSTRAINT "agency_invoices_number_shape" CHECK ("agency_invoices"."invoice_number" is null or "agency_invoices"."invoice_number" ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$'),
	CONSTRAINT "agency_invoices_total" CHECK ("agency_invoices"."total_cents" is null or ("agency_invoices"."total_cents" > 0 and "agency_invoices"."total_cents" <= 9007199254740991)),
	CONSTRAINT "agency_invoices_currency" CHECK ("agency_invoices"."currency" is null or "agency_invoices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "agency_invoices_period" CHECK ("agency_invoices"."period_end" is null or ("agency_invoices"."period_end" >= "agency_invoices"."period_start" and "agency_invoices"."period_end" - "agency_invoices"."period_start" <= 92)),
	CONSTRAINT "agency_invoices_email" CHECK ("agency_invoices"."paypal_email" is null or (length("agency_invoices"."paypal_email") <= 127 and "agency_invoices"."paypal_email" = lower("agency_invoices"."paypal_email") and "agency_invoices"."paypal_email" !~ '[[:space:]<>{}]'))
);
--> statement-breakpoint
ALTER TABLE "agency_invoice_lines" ADD CONSTRAINT "agency_invoice_lines_invoice_fk" FOREIGN KEY ("circle_id","invoice_id") REFERENCES "public"."agency_invoices"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_invoice_lines" ADD CONSTRAINT "agency_invoice_lines_visit_fk" FOREIGN KEY ("circle_id","visit_report_id") REFERENCES "public"."agency_visit_reports"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_invoiced_visits" ADD CONSTRAINT "agency_invoiced_visits_visit_fk" FOREIGN KEY ("circle_id","visit_report_id") REFERENCES "public"."agency_visit_reports"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_invoiced_visits" ADD CONSTRAINT "agency_invoiced_visits_invoice_fk" FOREIGN KEY ("circle_id","invoice_id") REFERENCES "public"."agency_invoices"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_invoices" ADD CONSTRAINT "agency_invoices_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_invoices" ADD CONSTRAINT "agency_invoices_key_fk" FOREIGN KEY ("circle_id","agency_key_id") REFERENCES "public"."agency_keys"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_invoices" ADD CONSTRAINT "agency_invoices_bill_fk" FOREIGN KEY ("circle_id","bill_id") REFERENCES "public"."bills"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agency_invoice_lines_visit_idx" ON "agency_invoice_lines" USING btree ("circle_id","visit_report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agency_invoiced_visits_live" ON "agency_invoiced_visits" USING btree ("circle_id","visit_report_id") WHERE "agency_invoiced_visits"."released_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "agency_invoices_number" ON "agency_invoices" USING btree ("agency_key_id","invoice_number") WHERE "agency_invoices"."invoice_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "agency_invoices_one_per_bill" ON "agency_invoices" USING btree ("circle_id","bill_id") WHERE "agency_invoices"."bill_id" is not null;--> statement-breakpoint
CREATE INDEX "agency_invoices_received_idx" ON "agency_invoices" USING btree ("circle_id","received_at");
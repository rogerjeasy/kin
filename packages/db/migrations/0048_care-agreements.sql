CREATE TABLE "care_agreement_signatures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"agreement_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"capacity" text NOT NULL,
	"method" "approval_method" NOT NULL,
	"signed_on" date NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "care_agreement_signatures_one_per_capacity" UNIQUE("agreement_id","capacity"),
	CONSTRAINT "care_agreement_signatures_one_per_member" UNIQUE("agreement_id","member_id"),
	CONSTRAINT "care_agreement_signatures_capacity" CHECK (capacity in ('caregiver', 'care_recipient', 'representative'))
);
--> statement-breakpoint
CREATE TABLE "care_agreements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"payee_id" uuid NOT NULL,
	"caregiver_member_id" uuid NOT NULL,
	"caregiver_relation" text NOT NULL,
	"duties" text[] NOT NULL,
	"weekly_minutes" integer NOT NULL,
	"rate_cents_per_hour" bigint NOT NULL,
	"starts_on" date NOT NULL,
	"end_term" text NOT NULL,
	"ends_on" date,
	"payer" text NOT NULL,
	"us_state" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"ended_on" date,
	"simulated" boolean NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "care_agreements_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "care_agreements_relation" CHECK (caregiver_relation in ('child', 'other_relative', 'not_related')),
	CONSTRAINT "care_agreements_duties" CHECK (array_ndims(duties) = 1 and array_position(duties, null) is null and array_to_string(duties, E'\x01') ~ '^[^<>\x01\s]([^<>\x01]{0,198}[^<>\x01\s])?(\x01[^<>\x01\s]([^<>\x01]{0,198}[^<>\x01\s])?){0,11}$'),
	CONSTRAINT "care_agreements_hours" CHECK (weekly_minutes between 1 and 5040),
	CONSTRAINT "care_agreements_rate" CHECK ("care_agreements"."rate_cents_per_hour" > 0 and "care_agreements"."rate_cents_per_hour" <= 1000000),
	CONSTRAINT "care_agreements_end_term" CHECK (end_term in ('either_party_30_days', 'fixed_end_date')),
	CONSTRAINT "care_agreements_fixed_end" CHECK (("care_agreements"."end_term" = 'fixed_end_date') = ("care_agreements"."ends_on" is not null) and ("care_agreements"."ends_on" is null or "care_agreements"."ends_on" > "care_agreements"."starts_on")),
	CONSTRAINT "care_agreements_payer" CHECK (payer in ('care_recipient', 'family_members')),
	CONSTRAINT "care_agreements_us_state" CHECK (us_state in ('AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY')),
	CONSTRAINT "care_agreements_state" CHECK (state in ('draft', 'withdrawn')),
	CONSTRAINT "care_agreements_ended" CHECK ("care_agreements"."ended_on" is null or ("care_agreements"."state" = 'draft' and "care_agreements"."ended_on" >= "care_agreements"."starts_on"))
);
--> statement-breakpoint
ALTER TABLE "care_agreement_signatures" ADD CONSTRAINT "care_agreement_signatures_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_agreement_signatures" ADD CONSTRAINT "care_agreement_signatures_agreement_fk" FOREIGN KEY ("circle_id","agreement_id") REFERENCES "public"."care_agreements"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_agreement_signatures" ADD CONSTRAINT "care_agreement_signatures_member_fk" FOREIGN KEY ("circle_id","member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_agreements" ADD CONSTRAINT "care_agreements_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_agreements" ADD CONSTRAINT "care_agreements_payee_fk" FOREIGN KEY ("circle_id","payee_id") REFERENCES "public"."payees"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_agreements" ADD CONSTRAINT "care_agreements_caregiver_fk" FOREIGN KEY ("circle_id","caregiver_member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_agreements" ADD CONSTRAINT "care_agreements_created_by_fk" FOREIGN KEY ("circle_id","created_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "care_agreements_payee_idx" ON "care_agreements" USING btree ("circle_id","payee_id");
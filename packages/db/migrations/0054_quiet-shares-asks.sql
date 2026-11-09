CREATE TABLE "quiet_share_asks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"cost_cents" bigint NOT NULL,
	"bill_id" uuid,
	"agreement_id" uuid NOT NULL,
	"asked" uuid[] NOT NULL,
	"start_month" text NOT NULL,
	"months" integer DEFAULT 1 NOT NULL,
	"state" text DEFAULT 'gathering' NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"answered_count" integer DEFAULT 0 NOT NULL,
	"part_count" integer DEFAULT 0 NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"shortfall_cents" bigint,
	"spread_would_cover" boolean,
	"pay_later_used" boolean DEFAULT false NOT NULL,
	"simulated" boolean NOT NULL,
	"raised_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "quiet_share_asks_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "quiet_share_asks_title" CHECK (char_length(title) between 1 and 80 and title !~ '[<>[:cntrl:]]' and title = btrim(title)),
	CONSTRAINT "quiet_share_asks_kind" CHECK (kind in ('one_off', 'monthly')),
	CONSTRAINT "quiet_share_asks_state" CHECK (state in ('gathering', 'short', 'planned', 'agreed', 'withdrawn')),
	CONSTRAINT "quiet_share_asks_cost" CHECK (cost_cents > 0 and cost_cents <= 5000000),
	CONSTRAINT "quiet_share_asks_month" CHECK (start_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "quiet_share_asks_months" CHECK (months = 1 or (months = 3 and kind = 'one_off')),
	CONSTRAINT "quiet_share_asks_asked" CHECK (cardinality("quiet_share_asks"."asked") between 1 and 12),
	CONSTRAINT "quiet_share_asks_counts" CHECK ("quiet_share_asks"."answered_count" between 0 and cardinality("quiet_share_asks"."asked") and "quiet_share_asks"."accepted_count" between 0 and "quiet_share_asks"."part_count" and "quiet_share_asks"."round" >= 0),
	CONSTRAINT "quiet_share_asks_shortfall" CHECK ("quiet_share_asks"."shortfall_cents" is null or "quiet_share_asks"."shortfall_cents" between 0 and "quiet_share_asks"."cost_cents")
);
--> statement-breakpoint
CREATE TABLE "quiet_share_parts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"ask_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"cents" bigint NOT NULL,
	"per_month" bigint[] NOT NULL,
	"pay_later_cents" bigint NOT NULL,
	"at_limit" boolean NOT NULL,
	"share_cents" bigint NOT NULL,
	"care_trips" integer NOT NULL,
	"care_minutes" integer NOT NULL,
	"care_value_cents" bigint NOT NULL,
	"accepted_at" timestamp with time zone,
	"method" text,
	"prepared_at" timestamp with time zone,
	"paypal_ref" text,
	"approval_url" text,
	CONSTRAINT "quiet_share_parts_one_per_round" UNIQUE("ask_id","round","member_id"),
	CONSTRAINT "quiet_share_parts_amounts" CHECK ("quiet_share_parts"."cents" >= 0 and "quiet_share_parts"."pay_later_cents" between 0 and "quiet_share_parts"."cents" and "quiet_share_parts"."share_cents" >= 0 and "quiet_share_parts"."care_value_cents" >= 0),
	CONSTRAINT "quiet_share_parts_method" CHECK (method is null or method in ('checkout', 'pay_later', 'invoice', 'monthly_share')),
	CONSTRAINT "quiet_share_parts_accepted" CHECK (("quiet_share_parts"."method" is null) = ("quiet_share_parts"."accepted_at" is null) and ("quiet_share_parts"."prepared_at" is null or "quiet_share_parts"."accepted_at" is not null)),
	CONSTRAINT "quiet_share_parts_approval_url" CHECK ("quiet_share_parts"."approval_url" is null or "quiet_share_parts"."approval_url" ~ '^https://([a-z0-9-]+\.)*paypal\.com/')
);
--> statement-breakpoint
CREATE TABLE "sealed_offers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"ask_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"monthly_cents" bigint NOT NULL,
	"step_up_cents" bigint,
	"step_up_from" text,
	"care_trips" integer DEFAULT 0 NOT NULL,
	"care_minutes" integer DEFAULT 0 NOT NULL,
	"earliest_month" text,
	"takes_shortfall" boolean DEFAULT false NOT NULL,
	"seals" integer DEFAULT 1 NOT NULL,
	"sealed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sealed_offers_one_per_member" UNIQUE("ask_id","member_id"),
	CONSTRAINT "sealed_offers_amount" CHECK (monthly_cents between 0 and 500000),
	CONSTRAINT "sealed_offers_step_up" CHECK ((step_up_cents is null) = (step_up_from is null) and (step_up_cents is null or (step_up_cents > monthly_cents and step_up_cents <= 500000))),
	CONSTRAINT "sealed_offers_step_up_month" CHECK (step_up_from is null or step_up_from ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "sealed_offers_earliest_month" CHECK (earliest_month is null or earliest_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "sealed_offers_care" CHECK (care_minutes between 0 and 3600 and care_trips between 0 and 31),
	CONSTRAINT "sealed_offers_seals" CHECK (seals between 1 and 3)
);
--> statement-breakpoint
ALTER TABLE "quiet_share_asks" ADD CONSTRAINT "quiet_share_asks_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiet_share_asks" ADD CONSTRAINT "quiet_share_asks_bill_fk" FOREIGN KEY ("circle_id","bill_id") REFERENCES "public"."bills"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiet_share_asks" ADD CONSTRAINT "quiet_share_asks_agreement_fk" FOREIGN KEY ("circle_id","agreement_id") REFERENCES "public"."agreements"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiet_share_asks" ADD CONSTRAINT "quiet_share_asks_raised_by_fk" FOREIGN KEY ("circle_id","raised_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiet_share_parts" ADD CONSTRAINT "quiet_share_parts_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiet_share_parts" ADD CONSTRAINT "quiet_share_parts_ask_fk" FOREIGN KEY ("circle_id","ask_id") REFERENCES "public"."quiet_share_asks"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiet_share_parts" ADD CONSTRAINT "quiet_share_parts_member_fk" FOREIGN KEY ("circle_id","member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sealed_offers" ADD CONSTRAINT "sealed_offers_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sealed_offers" ADD CONSTRAINT "sealed_offers_ask_fk" FOREIGN KEY ("circle_id","ask_id") REFERENCES "public"."quiet_share_asks"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sealed_offers" ADD CONSTRAINT "sealed_offers_member_fk" FOREIGN KEY ("circle_id","member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quiet_share_asks_state_idx" ON "quiet_share_asks" USING btree ("circle_id","state");
CREATE TABLE "parent_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"name" text NOT NULL,
	"monthly_cents" bigint NOT NULL,
	"paypal_subscription_id" text,
	"state" text DEFAULT 'active' NOT NULL,
	"held_by" uuid,
	"simulated" boolean NOT NULL,
	"changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parent_subscriptions_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "parent_subscriptions_name" CHECK (char_length("parent_subscriptions"."name") between 1 and 80 and "parent_subscriptions"."name" !~ '[<>]' and "parent_subscriptions"."name" = btrim("parent_subscriptions"."name")),
	CONSTRAINT "parent_subscriptions_cents" CHECK ("parent_subscriptions"."monthly_cents" > 0 and "parent_subscriptions"."monthly_cents" <= 10000000),
	CONSTRAINT "parent_subscriptions_paypal_id" CHECK ("parent_subscriptions"."paypal_subscription_id" is null or "parent_subscriptions"."paypal_subscription_id" ~ '^I-[A-Z0-9]{6,34}$'),
	CONSTRAINT "parent_subscriptions_state" CHECK (state in ('active', 'suspending', 'suspended', 'resuming')),
	CONSTRAINT "parent_subscriptions_simulated_unlinked" CHECK (not "parent_subscriptions"."simulated" or "parent_subscriptions"."paypal_subscription_id" is null)
);
--> statement-breakpoint
CREATE TABLE "wish_attestations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"trigger_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role" "circle_role" NOT NULL,
	"stance" text NOT NULL,
	"attested_at" timestamp with time zone NOT NULL,
	CONSTRAINT "wish_attestations_once" UNIQUE("trigger_id","member_id","stance"),
	CONSTRAINT "wish_attestations_stance" CHECK (stance in ('start', 'end')),
	CONSTRAINT "wish_attestations_role" CHECK ("wish_attestations"."role" in ('organizer', 'contributor', 'caregiver'))
);
--> statement-breakpoint
CREATE TABLE "wish_recordings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"recorded_by" uuid NOT NULL,
	"content_type" text NOT NULL,
	"audio" "bytea" NOT NULL,
	"sha256" text NOT NULL,
	"simulated" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wish_recordings_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "wish_recordings_type" CHECK ("wish_recordings"."content_type" = 'audio/wav'),
	CONSTRAINT "wish_recordings_size" CHECK (octet_length(audio) between 45 and 1920044),
	CONSTRAINT "wish_recordings_sha256" CHECK ("wish_recordings"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "wish_signatures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"wish_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role" "circle_role" NOT NULL,
	"capacity" text NOT NULL,
	"digest" text NOT NULL,
	"method" "approval_method" NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "wish_signatures_one_per_member" UNIQUE("wish_id","member_id"),
	CONSTRAINT "wish_signatures_capacity" CHECK ("wish_signatures"."capacity" in ('parent', 'witness') and ("wish_signatures"."capacity" = 'parent') = ("wish_signatures"."role" = 'parent'))
);
--> statement-breakpoint
CREATE TABLE "wish_triggers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"event" text NOT NULL,
	"state" text DEFAULT 'reported' NOT NULL,
	"reported_by" uuid NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"active_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"organizer_before" uuid,
	"organizer_during" uuid,
	"simulated" boolean NOT NULL,
	CONSTRAINT "wish_triggers_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "wish_triggers_event" CHECK (event in ('hospital', 'care_home')),
	CONSTRAINT "wish_triggers_state" CHECK (state in ('reported', 'active', 'ended', 'dismissed')),
	CONSTRAINT "wish_triggers_succession" CHECK (("wish_triggers"."organizer_before" is null) = ("wish_triggers"."organizer_during" is null))
);
--> statement-breakpoint
CREATE TABLE "wishes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"wish_key" uuid NOT NULL,
	"version" integer NOT NULL,
	"quote" text NOT NULL,
	"said_on" date NOT NULL,
	"trigger" text NOT NULL,
	"rule_kind" text NOT NULL,
	"rule" jsonb NOT NULL,
	"recording_id" uuid,
	"state" text DEFAULT 'draft' NOT NULL,
	"digest" text NOT NULL,
	"previous_digest" text,
	"simulated" boolean NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"in_force_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "wishes_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "wishes_one_version" UNIQUE("circle_id","wish_key","version"),
	CONSTRAINT "wishes_version" CHECK ("wishes"."version" >= 1),
	CONSTRAINT "wishes_quote" CHECK (char_length(quote) between 1 and 500 and quote !~ '[<>]' and quote = btrim(quote)),
	CONSTRAINT "wishes_trigger" CHECK (trigger in ('hospital', 'care_home', 'either')),
	CONSTRAINT "wishes_rule_kind" CHECK (rule_kind in ('keep_paying', 'pause_discretionary', 'suspend_subscriptions', 'new_payee_approvals', 'successor')),
	CONSTRAINT "wishes_rule_shape" CHECK (jsonb_typeof("wishes"."rule") = 'object' and "wishes"."rule" ->> 'kind' = "wishes"."rule_kind"),
	CONSTRAINT "wishes_state" CHECK (state in ('draft', 'confirmed', 'in_force', 'superseded', 'withdrawn')),
	CONSTRAINT "wishes_digest" CHECK ("wishes"."digest" ~ '^[0-9a-f]{64}$' and ("wishes"."previous_digest" is null or "wishes"."previous_digest" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "wishes_chain" CHECK (("wishes"."version" = 1) = ("wishes"."previous_digest" is null))
);
--> statement-breakpoint
ALTER TABLE "parent_subscriptions" ADD CONSTRAINT "parent_subscriptions_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_subscriptions" ADD CONSTRAINT "parent_subscriptions_held_by_fk" FOREIGN KEY ("circle_id","held_by") REFERENCES "public"."wish_triggers"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_attestations" ADD CONSTRAINT "wish_attestations_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_attestations" ADD CONSTRAINT "wish_attestations_trigger_fk" FOREIGN KEY ("circle_id","trigger_id") REFERENCES "public"."wish_triggers"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_attestations" ADD CONSTRAINT "wish_attestations_member_fk" FOREIGN KEY ("circle_id","member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_recordings" ADD CONSTRAINT "wish_recordings_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_recordings" ADD CONSTRAINT "wish_recordings_member_fk" FOREIGN KEY ("circle_id","recorded_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_signatures" ADD CONSTRAINT "wish_signatures_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_signatures" ADD CONSTRAINT "wish_signatures_wish_fk" FOREIGN KEY ("circle_id","wish_id") REFERENCES "public"."wishes"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_signatures" ADD CONSTRAINT "wish_signatures_member_fk" FOREIGN KEY ("circle_id","member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_triggers" ADD CONSTRAINT "wish_triggers_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_triggers" ADD CONSTRAINT "wish_triggers_reported_by_fk" FOREIGN KEY ("circle_id","reported_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_triggers" ADD CONSTRAINT "wish_triggers_organizer_before_fk" FOREIGN KEY ("circle_id","organizer_before") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_triggers" ADD CONSTRAINT "wish_triggers_organizer_during_fk" FOREIGN KEY ("circle_id","organizer_during") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishes" ADD CONSTRAINT "wishes_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishes" ADD CONSTRAINT "wishes_created_by_fk" FOREIGN KEY ("circle_id","created_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishes" ADD CONSTRAINT "wishes_recording_fk" FOREIGN KEY ("circle_id","recording_id") REFERENCES "public"."wish_recordings"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "parent_subscriptions_paypal_once" ON "parent_subscriptions" USING btree ("paypal_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wish_triggers_one_open" ON "wish_triggers" USING btree ("circle_id") WHERE state in ('reported', 'active');--> statement-breakpoint
CREATE UNIQUE INDEX "wishes_one_in_force" ON "wishes" USING btree ("circle_id","wish_key") WHERE state = 'in_force';--> statement-breakpoint
CREATE UNIQUE INDEX "wishes_one_waiting" ON "wishes" USING btree ("circle_id","wish_key") WHERE state in ('draft', 'confirmed');--> statement-breakpoint
CREATE INDEX "wishes_state_idx" ON "wishes" USING btree ("circle_id","state");
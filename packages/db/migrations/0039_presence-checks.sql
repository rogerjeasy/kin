CREATE TABLE "presence_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"source" text NOT NULL,
	"call_sid" text,
	"opened_by" uuid,
	"voice_id" uuid,
	"claimed_name" text,
	"claimed_relationship" text,
	"claimed_cents" bigint,
	"markers" text[] DEFAULT '{}' NOT NULL,
	"said" text[] DEFAULT '{}' NOT NULL,
	"state" text DEFAULT 'opened' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"token_hash" text NOT NULL,
	"ask_message_sid" text,
	"asked_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"hold_until" timestamp with time zone,
	"alerts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "presence_checks_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "presence_checks_token" UNIQUE("token_hash"),
	CONSTRAINT "presence_checks_source" CHECK ("presence_checks"."source" in ('app', 'phone')),
	CONSTRAINT "presence_checks_state" CHECK (state in ('opened', 'asked', 'unanswered', 'confirmed', 'denied', 'expired')),
	CONSTRAINT "presence_checks_amount" CHECK ("presence_checks"."claimed_cents" is null or "presence_checks"."claimed_cents" > 0),
	CONSTRAINT "presence_checks_hash" CHECK ("presence_checks"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "presence_checks_locale" CHECK ("presence_checks"."locale" in ('en', 'fr', 'de', 'it', 'es', 'ar', 'he')),
	CONSTRAINT "presence_checks_said" CHECK (cardinality("presence_checks"."said") <= 12)
);
--> statement-breakpoint
CREATE TABLE "trusted_voices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"phone" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"confirm_token_hash" text,
	"confirm_expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"added_by" uuid NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trusted_voices_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "trusted_voices_name" CHECK (length(btrim("trusted_voices"."name")) between 1 and 80),
	CONSTRAINT "trusted_voices_relationship" CHECK (length(btrim("trusted_voices"."relationship")) between 1 and 80),
	CONSTRAINT "trusted_voices_phone_shape" CHECK ("trusted_voices"."phone" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "trusted_voices_locale" CHECK ("trusted_voices"."locale" in ('en', 'fr', 'de', 'it', 'es', 'ar', 'he')),
	CONSTRAINT "trusted_voices_hash" CHECK ("trusted_voices"."confirm_token_hash" is null or "trusted_voices"."confirm_token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "presence_checks" ADD CONSTRAINT "presence_checks_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_checks" ADD CONSTRAINT "presence_checks_opened_by_fk" FOREIGN KEY ("circle_id","opened_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_checks" ADD CONSTRAINT "presence_checks_voice_fk" FOREIGN KEY ("circle_id","voice_id") REFERENCES "public"."trusted_voices"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_voices" ADD CONSTRAINT "trusted_voices_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_voices" ADD CONSTRAINT "trusted_voices_added_by_fk" FOREIGN KEY ("circle_id","added_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "presence_checks_call" ON "presence_checks" USING btree ("circle_id","call_sid") WHERE "presence_checks"."call_sid" is not null;--> statement-breakpoint
CREATE INDEX "presence_checks_circle_idx" ON "presence_checks" USING btree ("circle_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trusted_voices_phone" ON "trusted_voices" USING btree ("circle_id","phone") WHERE "trusted_voices"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "trusted_voices_confirm_token" ON "trusted_voices" USING btree ("confirm_token_hash") WHERE "trusted_voices"."confirm_token_hash" is not null;
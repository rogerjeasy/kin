CREATE TABLE "family_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"seed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "family_codes_one_per_circle" UNIQUE("circle_id"),
	CONSTRAINT "family_codes_seed" CHECK ("family_codes"."seed" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "payees" ADD COLUMN "voice_id" uuid;--> statement-breakpoint
ALTER TABLE "presence_checks" ADD COLUMN "call_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "presence_checks" ADD COLUMN "ask_call_sid" text;--> statement-breakpoint
ALTER TABLE "presence_checks" ADD COLUMN "answered_via" text;--> statement-breakpoint
ALTER TABLE "presence_checks" ADD COLUMN "help_proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "trusted_voices" ADD COLUMN "aliases" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "trusted_voices" ADD COLUMN "paypal_receiver" text;--> statement-breakpoint
ALTER TABLE "trusted_voices" ADD COLUMN "receiver_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "family_codes" ADD CONSTRAINT "family_codes_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_checks" ADD CONSTRAINT "presence_checks_answered_via" CHECK ("presence_checks"."answered_via" is null or "presence_checks"."answered_via" in ('link', 'call'));--> statement-breakpoint
ALTER TABLE "presence_checks" ADD CONSTRAINT "presence_checks_call_sid" CHECK ("presence_checks"."ask_call_sid" is null or "presence_checks"."ask_call_sid" ~ '^[A-Za-z0-9]{1,64}$');--> statement-breakpoint
ALTER TABLE "trusted_voices" ADD CONSTRAINT "trusted_voices_aliases" CHECK (cardinality("trusted_voices"."aliases") <= 5 and length(array_to_string("trusted_voices"."aliases", '')) <= 400);--> statement-breakpoint
ALTER TABLE "trusted_voices" ADD CONSTRAINT "trusted_voices_receiver" CHECK (("trusted_voices"."paypal_receiver" is null) = ("trusted_voices"."receiver_confirmed_at" is null) and ("trusted_voices"."paypal_receiver" is null or "trusted_voices"."paypal_receiver" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));
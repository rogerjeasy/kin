CREATE TABLE "office_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"caller_number" text,
	"caller_name" text,
	"organization" text,
	"claimed_cents" bigint,
	"purpose" text,
	"reference" text,
	"transcript" jsonb NOT NULL,
	"verdict" "claim_verdict" NOT NULL,
	"pressure_signals" text[] DEFAULT '{}'::text[] NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"claim_check_id" uuid NOT NULL,
	"called_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_calls_circle_row" UNIQUE("circle_id","id"),
	CONSTRAINT "office_calls_claimed_positive" CHECK ("office_calls"."claimed_cents" is null or "office_calls"."claimed_cents" > 0),
	CONSTRAINT "office_calls_transcript_list" CHECK (jsonb_typeof("office_calls"."transcript") = 'array')
);
--> statement-breakpoint
ALTER TABLE "office_calls" ADD CONSTRAINT "office_calls_claim_check_fk" FOREIGN KEY ("circle_id","claim_check_id") REFERENCES "public"."claim_checks"("circle_id","id") ON DELETE no action ON UPDATE no action;
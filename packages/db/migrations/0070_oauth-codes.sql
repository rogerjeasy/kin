CREATE TABLE "oauth_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"client_id" text NOT NULL,
	"client_name" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"scope" text NOT NULL,
	"days" integer NOT NULL,
	"resource" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"delegation_id" uuid,
	CONSTRAINT "oauth_codes_hash" CHECK ("oauth_codes"."code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "oauth_codes_challenge" CHECK ("oauth_codes"."code_challenge" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "oauth_codes_scope" CHECK (scope in ('read', 'propose')),
	CONSTRAINT "oauth_codes_days" CHECK ("oauth_codes"."days" in (1, 7, 30, 90)),
	CONSTRAINT "oauth_codes_client" CHECK (length("oauth_codes"."client_id") between 1 and 2048),
	CONSTRAINT "oauth_codes_client_name" CHECK (length(btrim("oauth_codes"."client_name")) between 1 and 60 and "oauth_codes"."client_name" !~ '[<>{}\n\r]'),
	CONSTRAINT "oauth_codes_redirect" CHECK (length("oauth_codes"."redirect_uri") between 1 and 512),
	CONSTRAINT "oauth_codes_resource" CHECK (length("oauth_codes"."resource") between 1 and 512),
	CONSTRAINT "oauth_codes_expiry" CHECK (expires_at > created_at and expires_at <= created_at + interval '60 seconds'),
	CONSTRAINT "oauth_codes_used" CHECK ("oauth_codes"."delegation_id" is null or "oauth_codes"."used_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "delegations" ADD COLUMN "oauth_client" text;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_member_fk" FOREIGN KEY ("circle_id","member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_delegation_fk" FOREIGN KEY ("circle_id","delegation_id") REFERENCES "public"."delegations"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_codes_code" ON "oauth_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "oauth_codes_member_idx" ON "oauth_codes" USING btree ("circle_id","member_id","created_at");--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_oauth_client" CHECK ("delegations"."oauth_client" is null or length("delegations"."oauth_client") between 1 and 2048);
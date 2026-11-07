CREATE TABLE "audit_heads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"entry_count" integer NOT NULL,
	"head" text NOT NULL,
	"kind" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_heads_once" UNIQUE("circle_id","entry_count","head"),
	CONSTRAINT "audit_heads_count" CHECK ("audit_heads"."entry_count" >= 0),
	CONSTRAINT "audit_heads_hash" CHECK ("audit_heads"."head" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "audit_heads_kind" CHECK ("audit_heads"."kind" in ('verify', 'export'))
);
--> statement-breakpoint
ALTER TABLE "audit_heads" ADD CONSTRAINT "audit_heads_circle_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_heads" ADD CONSTRAINT "audit_heads_member_fk" FOREIGN KEY ("circle_id","recorded_by") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_heads_circle_idx" ON "audit_heads" USING btree ("circle_id","entry_count");
CREATE TYPE "public"."user_kind" AS ENUM('person', 'demo_visitor');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "kind" "user_kind" DEFAULT 'person' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_demo_visitor_id" CHECK (("users"."kind" = 'demo_visitor') = ("users"."id" like 'demo:%'));
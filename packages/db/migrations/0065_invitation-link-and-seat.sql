ALTER TABLE "invitations" ADD COLUMN "link_token_hash" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "seat_member_id" uuid;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_seat_fk" FOREIGN KEY ("circle_id","seat_member_id") REFERENCES "public"."members"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_link_token" ON "invitations" USING btree ("link_token_hash") WHERE "invitations"."link_token_hash" is not null;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_seat_for_parent" CHECK ("invitations"."seat_member_id" is null or "invitations"."role" = 'parent');--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_link_hash" CHECK ("invitations"."link_token_hash" is null or "invitations"."link_token_hash" ~ '^[0-9a-f]{64}$');
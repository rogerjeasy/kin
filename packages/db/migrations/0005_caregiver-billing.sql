ALTER TABLE "bills" ADD COLUMN "caregiver_details" jsonb;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "submission_key" uuid;--> statement-breakpoint
ALTER TABLE "payees" ADD COLUMN "caregiver_rate_cents_per_hour" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "payees_one_caregiver_rate" ON "payees" USING btree ("circle_id","member_id") WHERE "payees"."caregiver_rate_cents_per_hour" is not null;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_submission_once" UNIQUE("circle_id","submission_key");--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_caregiver_complete" CHECK (("bills"."caregiver_details" is null) = ("bills"."submission_key" is null));--> statement-breakpoint
ALTER TABLE "payees" ADD CONSTRAINT "payees_caregiver_rate" CHECK ("payees"."caregiver_rate_cents_per_hour" is null or ("payees"."member_id" is not null and "payees"."caregiver_rate_cents_per_hour" > 0 and "payees"."caregiver_rate_cents_per_hour" <= 9007199254740991));
ALTER TYPE "public"."shift_state" ADD VALUE 'credited';--> statement-breakpoint
ALTER TABLE "shifts" DROP CONSTRAINT "shifts_state_matches_keys";--> statement-breakpoint
ALTER TABLE "care_entries" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "care_entries" ADD CONSTRAINT "care_entries_shift_fk" FOREIGN KEY ("circle_id","shift_id") REFERENCES "public"."shifts"("circle_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_entries" ADD CONSTRAINT "care_entries_one_per_shift" UNIQUE("circle_id","shift_id");--> statement-breakpoint
ALTER TABLE "care_entries" ADD CONSTRAINT "care_entries_shift_has_entry" CHECK ("care_entries"."shift_id" is null or ("care_entries"."approved" and "care_entries"."ledger_entry_id" is not null));--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_state_matches_keys" CHECK (("shifts"."state" <> 'scheduled' or ("shifts"."checked_in_at" is null and "shifts"."family_confirmed_at" is null))
        and ("shifts"."state" <> 'checked_in' or ("shifts"."checked_in_at" is not null and "shifts"."checked_out_at" is null))
        and ("shifts"."state" <> 'checked_out' or ("shifts"."checked_out_at" is not null and "shifts"."family_confirmed_at" is null))
        and ("shifts"."state"::text not in ('confirmed', 'priced', 'paid', 'credited') or ("shifts"."checked_out_at" is not null and "shifts"."family_confirmed_at" is not null)));
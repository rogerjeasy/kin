-- The two keys of a shift stay independent, whoever holds a check-in link.
--
-- A check-in link acts for the shift's caregiver (0037), and a member of the
-- family may make one. Without this rule one family member could make a link,
-- tap in and out through it as the caregiver, and then give the family's word:
-- both keys turned by one person, who then moves money under the parent's
-- standing permission. Now nobody gives the family's word for a visit they
-- tapped through a link they made, in either order:
--   * the word is refused if its giver made a link that has been used on the shift;
--   * a link is refused to whoever has already given the word for the shift;
--   * a link is refused its use when the member who made it has given the word.
-- All three refuse with KS005, the code of "nobody confirms their own shift".
-- A demo circle is exempt: one visitor plays every role there and its money is
-- simulated. The parent's word given by Kin's phone call is covered too, as it
-- is recorded through the same column.
CREATE FUNCTION kin_private.assert_word_independent() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF OLD.family_confirmed_at IS NULL AND NEW.family_confirmed_at IS NOT NULL AND NEW.family_confirmed_by IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.circles c WHERE c.id = NEW.circle_id AND c.demo)
       AND EXISTS (
         SELECT 1 FROM public.shift_check_links l
         WHERE l.circle_id = NEW.circle_id AND l.shift_id = NEW.id AND l.created_by = NEW.family_confirmed_by AND l.uses > 0
       ) THEN
      RAISE EXCEPTION 'kin: nobody gives the family''s word for a visit they tapped through a link they made'
        USING ERRCODE = 'KS005';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER word_independent BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_word_independent();
--> statement-breakpoint

CREATE FUNCTION kin_private.assert_link_independent() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.circles c WHERE c.id = NEW.circle_id AND c.demo)
       AND EXISTS (
         SELECT 1 FROM public.shifts s
         WHERE s.circle_id = NEW.circle_id AND s.id = NEW.shift_id AND s.family_confirmed_by = NEW.created_by
       ) THEN
      RAISE EXCEPTION 'kin: nobody makes a check-in link for a visit they have already given the family''s word for'
        USING ERRCODE = 'KS005';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER link_independent BEFORE INSERT ON public.shift_check_links
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_link_independent();
--> statement-breakpoint

CREATE FUNCTION kin_private.assert_link_use_independent() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NEW.uses > OLD.uses
       AND NOT EXISTS (SELECT 1 FROM public.circles c WHERE c.id = NEW.circle_id AND c.demo)
       AND EXISTS (
         SELECT 1 FROM public.shifts s
         WHERE s.circle_id = NEW.circle_id AND s.id = NEW.shift_id AND s.family_confirmed_by = NEW.created_by
       ) THEN
      RAISE EXCEPTION 'kin: a link made by the member who gave the family''s word for the visit cannot turn the caregiver''s key'
        USING ERRCODE = 'KS005';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER link_use_independent BEFORE UPDATE OF uses ON public.shift_check_links
  FOR EACH ROW EXECUTE FUNCTION kin_private.assert_link_use_independent();
--> statement-breakpoint

REVOKE ALL ON FUNCTION kin_private.assert_word_independent() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.assert_link_use_independent() FROM PUBLIC;
REVOKE ALL ON FUNCTION kin_private.assert_link_independent() FROM PUBLIC;

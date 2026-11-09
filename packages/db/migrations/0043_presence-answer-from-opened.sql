-- A person can answer in the instant after their text goes out and before the worker has recorded it as sent. Their
-- link is real from the moment Kin made the check, so an answer must count then too: above all a "not me", which only
-- ever makes Kin more careful. (`opened` is still never `confirmed` by anything but the person's own tap.)
INSERT INTO kin_private.state_transitions (machine, from_state, to_state) VALUES
  ('presence', 'opened', 'confirmed'),
  ('presence', 'opened', 'denied');

-- The family code's seed is read by no role of the web app, by policy, and the table is held to the same shape as every
-- circle table: the app's role is given the two plain columns and no policy, as for check-in links, so a probe of the
-- table finds nothing and only the seed operation hands the seed to a member.
GRANT SELECT (id, circle_id) ON public.family_codes TO kin_app;

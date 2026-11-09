-- Money that arrives wakes the payments waiting for it.
--
-- A payout or a refill that the pool could not yet cover is looked at again
-- every quarter of an hour (the worker's held delay). When a top-up, a monthly
-- share or a paid invoice is written to the ledger, the circle's waiting
-- payout and purchase messages are made due now instead, so a caregiver paid
-- from a top-up is paid within seconds of it. Waking a message moves no money:
-- the worker checks the balance, the pause and every hold again as it always
-- does. Kin's service may wake its own circle; a member may wake theirs, as a
-- demo's simulated share is recorded by the person.

CREATE FUNCTION kin_private.wake_waiting_money(p_circle uuid) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_woken integer;
  BEGIN
    IF NOT ((session_user = 'kin_service' AND p_circle = kin_private.circle_id()) OR kin_private.my_member_id(p_circle) IS NOT NULL) THEN
      RAISE EXCEPTION 'kin: waking payments refused' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE public.outbox SET available_at = now()
      WHERE circle_id = p_circle AND topic IN ('payout.execute', 'purchase.execute') AND sent_at IS NULL AND available_at > now();
    GET DIAGNOSTICS v_woken = ROW_COUNT;
    RETURN v_woken;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION kin_private.wake_waiting_money(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kin_private.wake_waiting_money(uuid) TO kin_app, kin_service;

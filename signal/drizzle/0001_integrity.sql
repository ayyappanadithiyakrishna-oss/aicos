-- Forecast snapshots are immutable: revisions are new rows (see prediction_revisions).
CREATE OR REPLACE FUNCTION signal_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable: % rejected (create a revision instead)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER predictions_immutable
  BEFORE UPDATE OR DELETE ON predictions
  FOR EACH ROW EXECUTE FUNCTION signal_reject_mutation();
--> statement-breakpoint
-- Realizations may only move out of 'pending'; resolved/failed records are final.
CREATE OR REPLACE FUNCTION signal_realization_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'forecast_realizations cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'realization % is final (status %)', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER realizations_final
  BEFORE UPDATE OR DELETE ON forecast_realizations
  FOR EACH ROW EXECUTE FUNCTION signal_realization_guard();
--> statement-breakpoint
-- Append-only audit trail.
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION signal_reject_mutation();

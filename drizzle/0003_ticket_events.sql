CREATE OR REPLACE FUNCTION tickets_notify_change() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'INSERT'
		OR NEW.status IS DISTINCT FROM OLD.status
		OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
		PERFORM pg_notify('sector7_events', json_build_object('kind', 'tickets', 'areaId', NEW.area_id)::text);
	END IF;
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tickets_notify_change ON tickets;
--> statement-breakpoint
CREATE TRIGGER tickets_notify_change
	AFTER INSERT OR UPDATE OF status, assignee_id ON tickets
	FOR EACH ROW EXECUTE FUNCTION tickets_notify_change();

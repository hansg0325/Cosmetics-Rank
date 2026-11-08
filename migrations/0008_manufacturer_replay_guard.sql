CREATE TRIGGER entry_manufacturer_replay_guard BEFORE INSERT ON ranking_entries BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM ranking_entries e WHERE e.snapshot_id=NEW.snapshot_id AND e.rank=NEW.rank AND (e.manufacturer_name_at_capture IS NOT NEW.manufacturer_name_at_capture OR e.seller_name_at_capture IS NOT NEW.seller_name_at_capture OR e.manufacturer_disclosure_at_capture IS NOT NEW.manufacturer_disclosure_at_capture)) THEN RAISE(ABORT,'conflicting manufacturer replay') END;
END;

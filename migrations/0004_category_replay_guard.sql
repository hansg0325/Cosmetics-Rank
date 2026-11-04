CREATE TRIGGER entry_category_replay_guard BEFORE INSERT ON ranking_entries BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM ranking_entries e WHERE e.snapshot_id=NEW.snapshot_id AND e.rank=NEW.rank AND e.product_category_at_capture IS NOT NEW.product_category_at_capture) THEN RAISE(ABORT,'conflicting category replay') END;
END;

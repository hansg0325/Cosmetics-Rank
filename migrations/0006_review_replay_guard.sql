CREATE TRIGGER entry_review_replay_guard BEFORE INSERT ON ranking_entries BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM ranking_entries e WHERE e.snapshot_id=NEW.snapshot_id AND e.rank=NEW.rank AND (e.review_count_at_capture IS NOT NEW.review_count_at_capture OR e.rating_at_capture IS NOT NEW.rating_at_capture)) THEN RAISE(ABORT,'conflicting review replay') END;
END;

-- Additive safeguards; original supplied schema remains unchanged.
CREATE TRIGGER entry_import_guard BEFORE INSERT ON ranking_entries BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM snapshots WHERE id=NEW.snapshot_id AND status='IMPORTING') THEN RAISE(ABORT,'snapshot closed') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM ranking_entries e WHERE e.snapshot_id=NEW.snapshot_id AND e.rank=NEW.rank AND (e.product_id<>NEW.product_id OR e.product_name_at_capture<>NEW.product_name_at_capture OR e.brand_name_at_capture IS NOT NEW.brand_name_at_capture OR e.list_price IS NOT NEW.list_price OR e.sale_price IS NOT NEW.sale_price OR e.product_url_at_capture IS NOT NEW.product_url_at_capture)) THEN RAISE(ABORT,'conflicting replay') END;
END;
CREATE TRIGGER snapshot_complete_guard BEFORE UPDATE OF status ON snapshots WHEN NEW.status='COMPLETE' AND OLD.status<>'COMPLETE' BEGIN
 SELECT CASE WHEN OLD.status<>'IMPORTING' OR (SELECT COUNT(*) FROM ranking_entries WHERE snapshot_id=NEW.id)<>NEW.expected_count OR (SELECT MIN(rank) FROM ranking_entries WHERE snapshot_id=NEW.id)<>1 OR (SELECT MAX(rank) FROM ranking_entries WHERE snapshot_id=NEW.id)<>NEW.expected_count THEN RAISE(ABORT,'incomplete ranks') END;
END;

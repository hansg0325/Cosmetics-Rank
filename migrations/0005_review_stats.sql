ALTER TABLE ranking_entries ADD COLUMN review_count_at_capture INTEGER CHECK(review_count_at_capture IS NULL OR review_count_at_capture BETWEEN 0 AND 1000000000);
ALTER TABLE ranking_entries ADD COLUMN rating_at_capture REAL CHECK(rating_at_capture IS NULL OR rating_at_capture BETWEEN 0 AND 5);

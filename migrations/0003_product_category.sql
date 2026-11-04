-- Product taxonomy is separate from the ranking source (e.g. overall).
ALTER TABLE ranking_entries ADD COLUMN product_category_at_capture TEXT;

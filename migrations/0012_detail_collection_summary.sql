ALTER TABLE ingestion_runs ADD COLUMN detail_status TEXT NOT NULL DEFAULT 'UNKNOWN'
  CHECK(detail_status IN ('UNKNOWN','NOT_COLLECTED','COMPLETE','PARTIAL','FAILED'));
ALTER TABLE ingestion_runs ADD COLUMN detail_total INTEGER NOT NULL DEFAULT 0
  CHECK(detail_total BETWEEN 0 AND 100);
ALTER TABLE ingestion_runs ADD COLUMN detail_succeeded INTEGER NOT NULL DEFAULT 0
  CHECK(detail_succeeded BETWEEN 0 AND 100);
ALTER TABLE ingestion_runs ADD COLUMN detail_access_limited INTEGER NOT NULL DEFAULT 0
  CHECK(detail_access_limited BETWEEN 0 AND 100);

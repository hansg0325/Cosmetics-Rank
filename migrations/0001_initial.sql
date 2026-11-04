-- OliveRank D1 SQLite schema v2.0
-- Date/time: YYYY-MM-DD for ranking_date (Asia/Seoul), ISO 8601 UTC for *_at.
-- Caution: Access control is enforced by Cloudflare Access and API middleware.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS products (
  product_id TEXT PRIMARY KEY,
  brand_name TEXT,
  product_name TEXT NOT NULL,
  product_url TEXT,
  image_url TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id TEXT PRIMARY KEY,
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('MANUAL','FIXTURE','SCHEDULED','APPROVED_API')),
  status TEXT NOT NULL CHECK(status IN ('RUNNING','COMPLETE','PARTIAL','FAILED','CANCELLED')),
  source_ref TEXT,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ranking_date TEXT NOT NULL,
  category_code TEXT NOT NULL REFERENCES categories(code),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  status TEXT NOT NULL DEFAULT 'IMPORTING' CHECK(status IN ('IMPORTING','COMPLETE','FAILED')),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0,1)),
  expected_count INTEGER NOT NULL DEFAULT 100 CHECK(expected_count BETWEEN 1 AND 100),
  entry_count INTEGER NOT NULL DEFAULT 0 CHECK(entry_count BETWEEN 0 AND 100),
  ingestion_run_id TEXT REFERENCES ingestion_runs(id),
  source_type TEXT NOT NULL,
  source_ref TEXT,
  collected_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT,
  UNIQUE(ranking_date, category_code, version),
  CHECK (NOT (is_active = 1 AND status <> 'COMPLETE'))
);

-- Only one active snapshot can exist for any category/day.
CREATE UNIQUE INDEX IF NOT EXISTS ux_snapshots_active
  ON snapshots(ranking_date, category_code) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_snapshots_lookup
  ON snapshots(category_code, ranking_date DESC, status, is_active);
CREATE INDEX IF NOT EXISTS idx_snapshots_run
  ON snapshots(ingestion_run_id);

CREATE TABLE IF NOT EXISTS ranking_entries (
  snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 100),
  product_id TEXT NOT NULL REFERENCES products(product_id),
  brand_name_at_capture TEXT,
  product_name_at_capture TEXT NOT NULL,
  list_price INTEGER CHECK(list_price IS NULL OR list_price >= 0),
  sale_price INTEGER CHECK(sale_price IS NULL OR sale_price >= 0),
  product_url_at_capture TEXT,
  PRIMARY KEY(snapshot_id, rank),
  UNIQUE(snapshot_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_rank_entries_product
  ON ranking_entries(product_id, snapshot_id);

-- Initial categories are examples and must remain editable to match the real ranking tabs.
INSERT OR IGNORE INTO categories(code, display_name, sort_order) VALUES
 ('overall', '전체', 1),
 ('skincare', '스킨케어', 2),
 ('maskpack', '마스크팩', 3),
 ('cleansing', '클렌징', 4),
 ('suncare', '선케어', 5),
 ('makeup', '메이크업', 6),
 ('nail', '네일', 7),
 ('beautytools', '뷰티소품', 8),
 ('dermocosmetics', '더모 코스메틱', 9),
 ('fragrance', '향수/디퓨저', 10),
 ('haircare', '헤어케어', 11),
 ('bodycare', '바디케어', 12),
 ('luxe_edit', '럭스에딧', 13),
 ('mens_edit', '맨즈에딧', 14),
 ('health_food', '건강식품', 15),
 ('food', '푸드', 16),
 ('oralcare', '구강용품', 17),
 ('health_items', '헬스/건강용품', 18),
 ('hygiene', '위생용품', 19),
 ('fashion', '패션', 20),
 ('home_living', '홈리빙/가전', 21),
 ('hobby_stationery', '취미/팬시', 22);

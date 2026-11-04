INSERT INTO categories(code, display_name, sort_order) VALUES('chart_demo', '순위 변동 예시 (가상 데이터)', 999) ON CONFLICT(code) DO NOTHING;

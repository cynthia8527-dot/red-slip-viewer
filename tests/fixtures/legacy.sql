-- Synthetic prior-version fixture until actual production migrations are committed.
CREATE TABLE legacy_products (id TEXT PRIMARY KEY, name TEXT NOT NULL);
INSERT INTO legacy_products VALUES ('legacy-product', '舊商品');

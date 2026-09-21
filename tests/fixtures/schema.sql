-- Offline contract fixture only. This is NOT a copy of the remote Supabase schema.
PRAGMA foreign_keys = ON;
CREATE TABLE vendors (id TEXT PRIMARY KEY, short_name TEXT NOT NULL UNIQUE);
CREATE TABLE dispatch_locations (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT NOT NULL, reference_photo_path TEXT, CHECK(reference_photo_path IS NULL OR reference_photo_path LIKE 'products/' || id || '/%'));
CREATE TABLE vendor_prices (id TEXT PRIMARY KEY, vendor_id TEXT NOT NULL REFERENCES vendors(id), product_id TEXT NOT NULL REFERENCES products(id), unit_price REAL NOT NULL, effective_date TEXT NOT NULL, end_date TEXT, UNIQUE(vendor_id, product_id, effective_date));
CREATE TABLE shipments (id TEXT PRIMARY KEY, vendor_id TEXT NOT NULL REFERENCES vendors(id), product_id TEXT NOT NULL REFERENCES products(id), unit_price_snapshot REAL NOT NULL);
CREATE TABLE shipment_photos (id TEXT PRIMARY KEY, shipment_id TEXT NOT NULL REFERENCES shipments(id), storage_path TEXT NOT NULL UNIQUE, CHECK(storage_path LIKE 'shipments/' || shipment_id || '/%'));
CREATE TABLE operation_keys (key TEXT PRIMARY KEY, entity_id TEXT NOT NULL);

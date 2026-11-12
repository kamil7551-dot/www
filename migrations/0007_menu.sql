-- QR menu: allergens per item and the quick "not available today" switch.
-- allergens: comma-separated ids from core/allergens.ts, e.g. "gluten,milk".
ALTER TABLE items ADD COLUMN allergens TEXT NOT NULL DEFAULT '';
-- Unix time until which the item is sold out; NULL or in the past = available.
ALTER TABLE items ADD COLUMN sold_out_until INTEGER;

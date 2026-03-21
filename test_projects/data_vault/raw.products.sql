-- Raw landing table: products from source system
CREATE OR REPLACE TABLE raw.products AS
SELECT
    p.product_id,
    p.product_name,
    p.category,
    p.sub_category,
    p.unit_price,
    p.cost_price,
    p._loaded_at
FROM src.products_feed p;

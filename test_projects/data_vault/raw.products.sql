-- Raw landing table: products from source system
CREATE OR REPLACE TABLE raw.products AS
SELECT
    product_id,
    product_name,
    category,
    sub_category,
    unit_price,
    cost_price,
    _loaded_at
FROM src.products_feed;

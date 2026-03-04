-- Kimball product dimension with margin enrichment
-- Dep: src.raw_products
CREATE OR REPLACE TABLE dim.product AS
SELECT
    MD5(CAST(p.product_id AS VARCHAR))  AS product_key,
    p.product_id, p.sku,
    p.product_name, p.brand,
    p.category, p.sub_category,
    p.cost_price, p.list_price,
    ROUND((p.list_price - p.cost_price) / NULLIF(p.list_price, 0) * 100, 2) AS margin_pct,
    p.weight_kg,
    p.launch_date,
    p.discontinued_date,
    (p.discontinued_date IS NULL) AS is_active
FROM src.raw_products p;

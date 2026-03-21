-- Bronze: raw product catalog from ERP
CREATE OR REPLACE TABLE raw.products AS
SELECT
    p.product_id,
    p.product_name,
    p.category,
    p.sub_category,
    p.brand,
    p.cost_price,
    p.list_price,
    p.launch_date,
    p.is_active,
    p._loaded_at
FROM external_source.erp_db.product_catalog p;

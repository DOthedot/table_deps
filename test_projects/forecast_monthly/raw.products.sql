-- Bronze: raw product catalog from ERP
CREATE OR REPLACE TABLE raw.products AS
SELECT
    product_id,
    product_name,
    category,
    sub_category,
    brand,
    cost_price,
    list_price,
    launch_date,
    is_active,
    _loaded_at
FROM external_source.erp_db.product_catalog;

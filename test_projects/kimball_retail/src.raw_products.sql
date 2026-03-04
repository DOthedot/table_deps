-- Source: raw product catalog from ERP
CREATE OR REPLACE TABLE src.raw_products AS
SELECT
    product_id, sku, product_name, brand, category, sub_category,
    cost_price, list_price, weight_kg, launch_date, discontinued_date, _loaded_at
FROM external.erp_db.product_catalog;

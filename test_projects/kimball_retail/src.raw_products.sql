-- Source: raw product catalog from ERP
CREATE OR REPLACE TABLE src.raw_products AS
SELECT
    p.product_id, p.sku, p.product_name, p.brand, p.category, p.sub_category,
    p.cost_price, p.list_price, p.weight_kg, p.launch_date, p.discontinued_date, p._loaded_at
FROM external.erp_db.product_catalog p;

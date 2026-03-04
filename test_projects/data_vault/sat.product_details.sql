-- Data Vault Satellite: product descriptive attributes
-- Deps: hub.product, raw.products
CREATE OR REPLACE TABLE sat.product_details AS
SELECT
    hp.hub_product_hk,
    rp.product_name,
    rp.category,
    rp.sub_category,
    rp.unit_price,
    rp.cost_price,
    MD5(rp.product_name || rp.category || rp.sub_category) AS row_hash,
    rp._loaded_at   AS load_dts,
    'PIM'           AS record_source
FROM raw.products rp
JOIN hub.product  hp ON rp.product_id = hp.bk_product_id;

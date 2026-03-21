-- Data Vault Hub: product business keys
-- Deps: raw.products
CREATE OR REPLACE TABLE hub.product AS
SELECT
    MD5(rp.product_id)      AS hub_product_hk,
    rp.product_id           AS bk_product_id,
    'PIM'                   AS record_source,
    MIN(rp._loaded_at)      AS load_dts
FROM raw.products rp
GROUP BY rp.product_id;

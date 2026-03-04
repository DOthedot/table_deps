-- Data Vault Hub: product business keys
-- Deps: raw.products
CREATE OR REPLACE TABLE hub.product AS
SELECT
    MD5(product_id)         AS hub_product_hk,
    product_id              AS bk_product_id,
    'PIM'                   AS record_source,
    MIN(_loaded_at)         AS load_dts
FROM raw.products
GROUP BY 1, 2, 3;

-- Data Vault Hub: order business keys
-- Deps: raw.orders
CREATE OR REPLACE TABLE hub.order AS
SELECT
    MD5(order_id)           AS hub_order_hk,
    order_id                AS bk_order_id,
    'OMS'                   AS record_source,
    MIN(_loaded_at)         AS load_dts
FROM raw.orders
GROUP BY 1, 2, 3;

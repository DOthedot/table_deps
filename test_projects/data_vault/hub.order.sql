-- Data Vault Hub: order business keys
-- Deps: raw.orders
CREATE OR REPLACE TABLE hub.order AS
SELECT
    MD5(ro.order_id)        AS hub_order_hk,
    ro.order_id             AS bk_order_id,
    'OMS'                   AS record_source,
    MIN(ro._loaded_at)      AS load_dts
FROM raw.orders ro
GROUP BY ro.order_id;

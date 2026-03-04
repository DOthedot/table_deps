-- Data Vault Link: order ↔ customer relationship
-- Deps: hub.order, hub.customer, raw.orders
CREATE OR REPLACE TABLE link.order_customer AS
SELECT DISTINCT
    MD5(ho.hub_order_hk || hc.hub_customer_hk) AS link_order_customer_hk,
    ho.hub_order_hk,
    hc.hub_customer_hk,
    'OMS'                   AS record_source,
    ro._loaded_at           AS load_dts
FROM raw.orders ro
JOIN hub.order    ho ON ro.order_id    = ho.bk_order_id
JOIN hub.customer hc ON ro.customer_id = hc.bk_customer_id;

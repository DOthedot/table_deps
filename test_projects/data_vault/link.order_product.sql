-- Data Vault Link: order line items — order ↔ product
-- Deps: hub.order, hub.product, raw.order_items
CREATE OR REPLACE TABLE link.order_product AS
SELECT DISTINCT
    MD5(ho.hub_order_hk || hp.hub_product_hk) AS link_order_product_hk,
    ho.hub_order_hk,
    hp.hub_product_hk,
    oi.quantity,
    oi.unit_price,
    oi.discount,
    'OMS'                   AS record_source,
    oi._loaded_at           AS load_dts
FROM raw.order_items oi
JOIN hub.order   ho ON oi.order_id   = ho.bk_order_id
JOIN hub.product hp ON oi.product_id = hp.bk_product_id;

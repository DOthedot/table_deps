-- Data Vault Satellite: order descriptive attributes
-- Deps: hub.order, raw.orders
CREATE OR REPLACE TABLE sat.order_details AS
SELECT
    ho.hub_order_hk,
    ro.order_date,
    ro.ship_date,
    ro.ship_region,
    ro.status,
    ro.total_amount,
    MD5(ro.status || COALESCE(ro.ship_region, '')) AS row_hash,
    ro._loaded_at   AS load_dts,
    'OMS'           AS record_source
FROM raw.orders ro
JOIN hub.order  ho ON ro.order_id = ho.bk_order_id;

-- Data Vault Link: order ↔ employee (sales rep) relationship
-- Deps: hub.order, hub.employee, raw.orders
CREATE OR REPLACE TABLE link.order_employee AS
SELECT DISTINCT
    MD5(ho.hub_order_hk || he.hub_employee_hk) AS link_order_employee_hk,
    ho.hub_order_hk,
    he.hub_employee_hk,
    'OMS'                   AS record_source,
    ro._loaded_at           AS load_dts
FROM raw.orders ro
JOIN hub.order    ho ON ro.order_id    = ho.bk_order_id
JOIN hub.employee he ON ro.employee_id = he.bk_employee_id;

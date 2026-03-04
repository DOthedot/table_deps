-- Business Vault: product revenue aggregation
-- Deps: hub.product, link.order_product, sat.product_details, sat.order_details, hub.order
CREATE OR REPLACE TABLE bv.product_revenue AS
SELECT
    hp.bk_product_id                               AS product_id,
    spd.product_name,
    spd.category,
    spd.sub_category,
    COUNT(DISTINCT lop.hub_order_hk)               AS total_orders,
    SUM(lop.quantity)                              AS total_units_sold,
    SUM(lop.quantity * lop.unit_price)             AS gross_revenue,
    SUM(lop.quantity * lop.unit_price * (1 - lop.discount)) AS net_revenue,
    SUM(lop.quantity * (lop.unit_price - spd.cost_price))   AS gross_profit
FROM link.order_product    lop
JOIN hub.product           hp  ON lop.hub_product_hk  = hp.hub_product_hk
JOIN sat.product_details   spd ON hp.hub_product_hk   = spd.hub_product_hk
JOIN sat.order_details     sod ON lop.hub_order_hk    = sod.hub_order_hk
GROUP BY 1, 2, 3, 4;

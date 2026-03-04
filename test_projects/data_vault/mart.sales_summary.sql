-- Information Mart: sales summary for BI consumption
-- Deps: bv.customer_orders, bv.product_revenue, sat.order_details, link.order_customer, link.order_product, hub.customer, hub.product
CREATE OR REPLACE TABLE mart.sales_summary AS
WITH order_lines AS (
    SELECT
        lop.hub_order_hk,
        lop.hub_product_hk,
        loc.hub_customer_hk,
        sod.order_date,
        YEAR(sod.order_date)    AS order_year,
        MONTH(sod.order_date)   AS order_month,
        lop.quantity,
        lop.unit_price,
        lop.discount,
        lop.quantity * lop.unit_price                       AS gross_revenue,
        lop.quantity * lop.unit_price * (1 - lop.discount) AS net_revenue
    FROM link.order_product   lop
    JOIN link.order_customer  loc ON lop.hub_order_hk    = loc.hub_order_hk
    JOIN sat.order_details    sod ON lop.hub_order_hk    = sod.hub_order_hk
)
SELECT
    ol.order_year,
    ol.order_month,
    hc.bk_customer_id   AS customer_id,
    scd.customer_name,
    scd.region          AS customer_region,
    scd.segment         AS customer_segment,
    hp.bk_product_id    AS product_id,
    spd.product_name,
    spd.category,
    SUM(ol.quantity)        AS total_units,
    SUM(ol.gross_revenue)   AS gross_revenue,
    SUM(ol.net_revenue)     AS net_revenue,
    COUNT(DISTINCT ol.hub_order_hk) AS order_count
FROM order_lines           ol
JOIN hub.customer          hc  ON ol.hub_customer_hk = hc.hub_customer_hk
JOIN sat.customer_details  scd ON hc.hub_customer_hk = scd.hub_customer_hk
JOIN hub.product           hp  ON ol.hub_product_hk  = hp.hub_product_hk
JOIN sat.product_details   spd ON hp.hub_product_hk  = spd.hub_product_hk
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9;

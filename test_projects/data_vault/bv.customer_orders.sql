-- Business Vault: customer order metrics (derived/computed vault layer)
-- Deps: hub.customer, hub.order, link.order_customer, sat.order_details, sat.customer_details
CREATE OR REPLACE TABLE bv.customer_orders AS
WITH order_facts AS (
    SELECT
        loc.hub_customer_hk,
        loc.hub_order_hk,
        sod.order_date,
        sod.ship_date,
        sod.status,
        sod.total_amount
    FROM link.order_customer  loc
    JOIN sat.order_details    sod ON loc.hub_order_hk = sod.hub_order_hk
)
SELECT
    hc.bk_customer_id                              AS customer_id,
    scd.customer_name,
    scd.region,
    scd.segment,
    COUNT(DISTINCT of.hub_order_hk)                AS total_orders,
    SUM(of.total_amount)                           AS total_revenue,
    MIN(of.order_date)                             AS first_order_date,
    MAX(of.order_date)                             AS last_order_date,
    DATEDIFF('day', MAX(of.order_date), CURRENT_DATE) AS days_since_last_order
FROM order_facts       of
JOIN hub.customer      hc  ON of.hub_customer_hk   = hc.hub_customer_hk
JOIN sat.customer_details scd ON hc.hub_customer_hk = scd.hub_customer_hk
GROUP BY 1, 2, 3, 4;

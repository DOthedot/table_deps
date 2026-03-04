-- Information Mart: customer lifetime value for CRM
-- Deps: bv.customer_orders, bv.product_revenue, hub.customer, sat.customer_details, link.order_customer, link.order_product
CREATE OR REPLACE TABLE mart.customer_ltv AS
SELECT
    co.customer_id,
    co.customer_name,
    co.region,
    co.segment,
    co.total_orders,
    co.total_revenue,
    co.first_order_date,
    co.last_order_date,
    co.days_since_last_order,
    ROUND(co.total_revenue / NULLIF(co.total_orders, 0), 2)   AS avg_order_value,
    ROUND(co.total_revenue * 2.5, 2)                           AS estimated_ltv,
    CASE
        WHEN co.total_revenue > 10000 THEN 'Platinum'
        WHEN co.total_revenue > 5000  THEN 'Gold'
        WHEN co.total_revenue > 1000  THEN 'Silver'
        ELSE 'Bronze'
    END AS ltv_tier
FROM bv.customer_orders co;

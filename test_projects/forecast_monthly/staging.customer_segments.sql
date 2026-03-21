-- Silver: customer segmentation based on purchase history
-- Deps: raw.customers, staging.sales_cleaned
CREATE OR REPLACE TABLE staging.customer_segments AS
WITH customer_revenue AS (
    SELECT
        sc.customer_id,
        COUNT(DISTINCT sc.transaction_id) AS total_orders,
        SUM(sc.net_revenue)               AS total_revenue,
        MAX(sc.transaction_date)          AS last_purchase_date
    FROM staging.sales_cleaned sc
    GROUP BY sc.customer_id
)
SELECT
    c.customer_id,
    c.first_name,
    c.last_name,
    c.region,
    c.customer_tier,
    cr.total_orders,
    cr.total_revenue,
    cr.last_purchase_date,
    CASE
        WHEN cr.total_revenue >= 10000 THEN 'VIP'
        WHEN cr.total_revenue >= 2000  THEN 'High Value'
        WHEN cr.total_revenue >= 500   THEN 'Mid Value'
        ELSE                                'Low Value'
    END AS segment
FROM raw.customers c
LEFT JOIN customer_revenue cr ON c.customer_id = cr.customer_id;

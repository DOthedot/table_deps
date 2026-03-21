-- Gold mart: customer lifetime value and churn prediction features
-- Deps: staging.customer_segments, staging.sales_cleaned
CREATE OR REPLACE TABLE mart.customer_ltv AS
WITH monthly_spend AS (
    SELECT
        sc.customer_id,
        DATE_TRUNC('month', sc.transaction_date) AS month,
        SUM(sc.net_revenue)                      AS monthly_revenue
    FROM staging.sales_cleaned sc
    GROUP BY sc.customer_id, DATE_TRUNC('month', sc.transaction_date)
),
avg_monthly AS (
    SELECT
        ms.customer_id,
        AVG(ms.monthly_revenue)         AS avg_monthly_revenue,
        STDDEV(ms.monthly_revenue)      AS stddev_monthly_revenue,
        COUNT(DISTINCT ms.month)        AS active_months
    FROM monthly_spend ms
    GROUP BY ms.customer_id
)
SELECT
    cs.customer_id,
    cs.first_name,
    cs.last_name,
    cs.region,
    cs.segment,
    cs.total_orders,
    cs.total_revenue,
    cs.last_purchase_date,
    am.avg_monthly_revenue,
    am.stddev_monthly_revenue,
    am.active_months,
    -- Simple LTV estimate: avg monthly × 12 months × 3 years
    ROUND(am.avg_monthly_revenue * 36, 2) AS projected_ltv_3yr
FROM staging.customer_segments cs
JOIN avg_monthly am ON cs.customer_id = am.customer_id;

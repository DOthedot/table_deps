-- Gold mart: customer lifetime value and churn prediction features
-- Deps: staging.customer_segments, staging.sales_cleaned
CREATE OR REPLACE TABLE mart.customer_ltv AS
WITH monthly_spend AS (
    SELECT
        customer_id,
        DATE_TRUNC('month', transaction_date) AS month,
        SUM(net_revenue)                      AS monthly_revenue
    FROM staging.sales_cleaned
    GROUP BY 1, 2
),
avg_monthly AS (
    SELECT
        customer_id,
        AVG(monthly_revenue)         AS avg_monthly_revenue,
        STDDEV(monthly_revenue)      AS stddev_monthly_revenue,
        COUNT(DISTINCT month)        AS active_months
    FROM monthly_spend
    GROUP BY customer_id
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

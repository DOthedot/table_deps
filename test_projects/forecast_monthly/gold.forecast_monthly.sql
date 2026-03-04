-- Gold: monthly revenue forecast using historical trends + LTV signals
-- Deps: mart.monthly_sales, mart.customer_ltv
CREATE OR REPLACE TABLE gold.forecast_monthly AS
WITH trailing_12 AS (
    SELECT
        fiscal_year,
        fiscal_month,
        region,
        channel,
        category,
        total_revenue,
        LAG(total_revenue, 12) OVER (
            PARTITION BY region, channel, category
            ORDER BY fiscal_year, fiscal_month
        ) AS revenue_same_period_last_year,
        AVG(total_revenue) OVER (
            PARTITION BY region, channel, category
            ORDER BY fiscal_year, fiscal_month
            ROWS BETWEEN 11 PRECEDING AND CURRENT ROW
        ) AS rolling_12m_avg
    FROM mart.monthly_sales
),
ltv_signal AS (
    SELECT
        region,
        AVG(projected_ltv_3yr) AS avg_customer_ltv,
        COUNT(customer_id)     AS active_customers
    FROM mart.customer_ltv
    WHERE last_purchase_date >= CURRENT_DATE - INTERVAL '90 days'
    GROUP BY region
)
SELECT
    t.fiscal_year,
    t.fiscal_month,
    t.region,
    t.channel,
    t.category,
    t.total_revenue                   AS actual_revenue,
    t.rolling_12m_avg                 AS trend_baseline,
    t.revenue_same_period_last_year   AS yoy_reference,
    l.avg_customer_ltv,
    l.active_customers,
    -- Blended forecast: 60% trend + 40% YoY, adjusted by LTV growth signal
    ROUND(
        (0.6 * t.rolling_12m_avg + 0.4 * COALESCE(t.revenue_same_period_last_year, t.rolling_12m_avg))
        * (1 + 0.05 * LOG(GREATEST(l.avg_customer_ltv, 1) / 1000)),
        2
    ) AS forecasted_revenue
FROM trailing_12 t
LEFT JOIN ltv_signal l ON t.region = l.region;

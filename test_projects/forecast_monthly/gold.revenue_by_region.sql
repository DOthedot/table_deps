-- Gold: regional revenue summary combining forecast and LTV
-- Deps: gold.forecast_monthly, mart.customer_ltv, mart.monthly_sales
CREATE OR REPLACE TABLE gold.revenue_by_region AS
SELECT
    f.region,
    f.fiscal_year,
    f.fiscal_quarter,
    SUM(ms.total_revenue)          AS actual_quarterly_revenue,
    SUM(f.forecasted_revenue)      AS forecasted_quarterly_revenue,
    AVG(cl.projected_ltv_3yr)      AS avg_ltv,
    COUNT(DISTINCT cl.customer_id) AS customer_count,
    SUM(ms.gross_profit)           AS gross_profit,
    ROUND(SUM(ms.gross_profit) / NULLIF(SUM(ms.total_revenue), 0) * 100, 2) AS margin_pct
FROM gold.forecast_monthly f
JOIN mart.monthly_sales ms
    ON  f.region       = ms.region
    AND f.fiscal_year  = ms.fiscal_year
    AND f.fiscal_month = ms.fiscal_month
LEFT JOIN mart.customer_ltv cl ON f.region = cl.region
GROUP BY 1, 2, 3;

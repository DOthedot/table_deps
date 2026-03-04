-- Report: 360° customer view — purchase history, returns, LTV
-- Deps: fact.sales, fact.returns, dim.customer, dim.date
CREATE OR REPLACE TABLE rpt.customer_360 AS
WITH customer_sales AS (
    SELECT
        fs.customer_key,
        COUNT(DISTINCT fs.transaction_id) AS total_orders,
        SUM(fs.quantity)                  AS total_units,
        SUM(fs.net_revenue)               AS total_net_revenue,
        SUM(fs.gross_profit)              AS total_gross_profit,
        MAX(dd.full_date)                 AS last_purchase_date,
        MIN(dd.full_date)                 AS first_purchase_date,
        COUNT(DISTINCT dd.fiscal_year)    AS active_years
    FROM fact.sales fs
    JOIN dim.date dd ON fs.date_key = dd.date_key
    GROUP BY 1
),
customer_returns AS (
    SELECT
        fr.customer_key,
        COUNT(DISTINCT fr.transaction_id) AS total_returns,
        SUM(fr.returned_net_value)        AS total_returned_value
    FROM fact.returns fr
    GROUP BY 1
)
SELECT
    dc.customer_key,
    dc.customer_id,
    dc.first_name, dc.last_name,
    dc.loyalty_tier, dc.country, dc.tenure_years,

    -- Purchase behaviour
    COALESCE(cs.total_orders, 0)        AS total_orders,
    COALESCE(cs.total_units, 0)         AS total_units,
    COALESCE(cs.total_net_revenue, 0)   AS total_net_revenue,
    COALESCE(cs.total_gross_profit, 0)  AS total_gross_profit,
    cs.last_purchase_date,
    cs.first_purchase_date,
    DATEDIFF('day', cs.last_purchase_date, CURRENT_DATE) AS days_since_last_purchase,

    -- Returns
    COALESCE(cr.total_returns, 0)        AS total_returns,
    COALESCE(cr.total_returned_value, 0) AS total_returned_value,
    ROUND(COALESCE(cr.total_returns, 0) /
          NULLIF(COALESCE(cs.total_orders, 0), 0) * 100, 2) AS return_rate_pct,

    -- Simple LTV proxy
    ROUND(COALESCE(cs.total_net_revenue, 0) * 3.0, 2) AS estimated_ltv

FROM dim.customer dc
LEFT JOIN customer_sales   cs ON dc.customer_key = cs.customer_key
LEFT JOIN customer_returns cr ON dc.customer_key = cr.customer_key;

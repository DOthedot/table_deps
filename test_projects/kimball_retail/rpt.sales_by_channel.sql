-- Report: sales performance by channel × customer segment × period
-- Deps: fact.sales, dim.customer, dim.date, dim.promotion
CREATE OR REPLACE TABLE rpt.sales_by_channel AS
SELECT
    dd.fiscal_year,
    dd.fiscal_quarter,
    dd.month_name,
    fs.channel,
    dc.loyalty_tier,
    dc.country,
    dpr.promo_type,

    COUNT(DISTINCT fs.transaction_id)  AS num_transactions,
    COUNT(DISTINCT dc.customer_key)    AS unique_customers,
    SUM(fs.quantity)                   AS total_units,
    SUM(fs.gross_revenue)              AS gross_revenue,
    SUM(fs.net_revenue)                AS net_revenue,
    SUM(fs.gross_profit)               AS gross_profit,
    AVG(fs.net_revenue)                AS avg_order_value,
    SUM(fs.discount_amt)               AS total_discounts

FROM fact.sales fs
JOIN dim.customer  dc  ON fs.customer_key  = dc.customer_key
JOIN dim.date      dd  ON fs.date_key      = dd.date_key
LEFT JOIN dim.promotion dpr ON fs.promotion_key = dpr.promotion_key
GROUP BY 1, 2, 3, 4, 5, 6, 7;

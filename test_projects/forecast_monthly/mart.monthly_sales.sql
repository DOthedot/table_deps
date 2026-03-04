-- Gold mart: monthly aggregated sales with calendar grain
-- Deps: staging.sales_cleaned, staging.products_enriched, raw.calendar
CREATE OR REPLACE TABLE mart.monthly_sales AS
SELECT
    cal.year,
    cal.fiscal_year,
    cal.fiscal_quarter,
    cal.fiscal_month,
    cal.month_name,
    s.region,
    s.country,
    s.channel,
    s.category,
    s.sub_category,
    s.brand,
    COUNT(DISTINCT s.transaction_id) AS num_transactions,
    COUNT(DISTINCT s.customer_id)    AS unique_customers,
    SUM(s.quantity)                  AS total_units,
    SUM(s.net_revenue)               AS total_revenue,
    SUM(s.cogs)                      AS total_cogs,
    SUM(s.net_revenue - s.cogs)      AS gross_profit,
    AVG(pe.list_price)               AS avg_list_price
FROM staging.sales_cleaned s
JOIN raw.calendar            cal ON s.transaction_date = cal.full_date
JOIN staging.products_enriched pe ON s.product_id    = pe.product_id
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11;

-- Silver: products enriched with sales performance metrics
-- Deps: raw.products, staging.sales_cleaned
CREATE OR REPLACE TABLE staging.products_enriched AS
WITH product_sales AS (
    SELECT
        product_id,
        SUM(quantity)    AS total_units_sold,
        SUM(net_revenue) AS total_revenue,
        SUM(cogs)        AS total_cogs,
        COUNT(DISTINCT transaction_id) AS num_transactions
    FROM staging.sales_cleaned
    GROUP BY product_id
)
SELECT
    p.product_id,
    p.product_name,
    p.category,
    p.sub_category,
    p.brand,
    p.cost_price,
    p.list_price,
    p.launch_date,
    p.is_active,
    COALESCE(ps.total_units_sold, 0)  AS total_units_sold,
    COALESCE(ps.total_revenue, 0)     AS total_revenue,
    COALESCE(ps.total_cogs, 0)        AS total_cogs,
    COALESCE(ps.total_revenue - ps.total_cogs, 0) AS gross_profit,
    COALESCE(ps.num_transactions, 0)  AS num_transactions
FROM raw.products p
LEFT JOIN product_sales ps ON p.product_id = ps.product_id;

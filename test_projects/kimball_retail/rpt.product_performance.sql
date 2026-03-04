-- Report: product performance by store region and period
-- Deps: fact.sales, fact.returns, dim.product, dim.store, dim.date
CREATE OR REPLACE TABLE rpt.product_performance AS
WITH sales AS (
    SELECT
        fs.product_key, fs.store_key, fs.date_key,
        SUM(fs.quantity)      AS sold_qty,
        SUM(fs.gross_revenue) AS gross_rev,
        SUM(fs.net_revenue)   AS net_rev,
        SUM(fs.gross_profit)  AS gross_profit
    FROM fact.sales fs
    GROUP BY 1, 2, 3
),
returns AS (
    SELECT
        fr.product_key, fr.store_key, fr.date_key,
        SUM(fr.returned_qty)          AS ret_qty,
        SUM(fr.returned_net_value)    AS ret_value
    FROM fact.returns fr
    GROUP BY 1, 2, 3
)
SELECT
    dd.fiscal_year,
    dd.fiscal_quarter,
    dp.category, dp.sub_category, dp.brand, dp.product_name,
    ds.region, ds.store_type,

    COALESCE(s.sold_qty, 0)     AS sold_qty,
    COALESCE(r.ret_qty, 0)      AS returned_qty,
    COALESCE(s.sold_qty, 0)
      - COALESCE(r.ret_qty, 0) AS net_qty,
    COALESCE(s.gross_rev, 0)    AS gross_revenue,
    COALESCE(s.net_rev, 0)      AS net_revenue,
    COALESCE(s.gross_profit, 0) AS gross_profit,
    COALESCE(r.ret_value, 0)    AS return_value,
    ROUND(COALESCE(r.ret_qty, 0) / NULLIF(COALESCE(s.sold_qty, 0), 0) * 100, 2) AS return_rate_pct

FROM sales s
JOIN dim.product dp ON s.product_key = dp.product_key
JOIN dim.store   ds ON s.store_key   = ds.store_key
JOIN dim.date    dd ON s.date_key    = dd.date_key
LEFT JOIN returns r
    ON  s.product_key = r.product_key
    AND s.store_key   = r.store_key
    AND s.date_key    = r.date_key;

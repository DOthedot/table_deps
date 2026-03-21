/* Kimball retail example project — raw SQL files for the Project DAG example button.
   Loaded via buildGraphFromFiles() so columns are always parsed fresh by the JS parser. */
const KIMBALL_EXAMPLE_FILES = [
  {
    name: 'dim.customer.sql',
    content: `-- Kimball SCD-2 customer dimension
-- Dep: src.raw_customers
CREATE OR REPLACE TABLE dim.customer AS
SELECT
    MD5(CAST(c.customer_id AS VARCHAR) || CAST(c._loaded_at AS VARCHAR)) AS customer_key,
    c.customer_id,
    c.first_name, c.last_name,
    c.email, c.phone,
    c.city, c.state, c.country,
    c.gender,
    DATEDIFF('year', c.birth_date, CURRENT_DATE)     AS age,
    DATEDIFF('year', c.signup_date, CURRENT_DATE)    AS tenure_years,
    c.loyalty_tier,
    CASE
        WHEN c.loyalty_tier = 'PLATINUM' THEN 4
        WHEN c.loyalty_tier = 'GOLD'     THEN 3
        WHEN c.loyalty_tier = 'SILVER'   THEN 2
        ELSE 1
    END AS loyalty_rank,
    TRUE  AS is_current,
    c._loaded_at AS valid_from,
    NULL         AS valid_to
FROM src.raw_customers c;`
  },
  {
    name: 'dim.date.sql',
    content: `-- Kimball date dimension — no upstream project dependency
CREATE OR REPLACE TABLE dim.date AS
SELECT
    d.date_key,
    d.full_date,
    d.year, d.quarter, d.month, d.month_name,
    d.week_of_year, d.day_of_week, d.day_name,
    d.is_weekend, d.is_holiday, d.fiscal_year,
    d.fiscal_quarter, d.fiscal_month, d.fiscal_week
FROM external.util_db.dim_date d
WHERE d.full_date BETWEEN '2018-01-01' AND '2035-12-31';`
  },
  {
    name: 'dim.product.sql',
    content: `-- Kimball product dimension with margin enrichment
-- Dep: src.raw_products
CREATE OR REPLACE TABLE dim.product AS
SELECT
    MD5(CAST(p.product_id AS VARCHAR))  AS product_key,
    p.product_id, p.sku,
    p.product_name, p.brand,
    p.category, p.sub_category,
    p.cost_price, p.list_price,
    ROUND((p.list_price - p.cost_price) / NULLIF(p.list_price, 0) * 100, 2) AS margin_pct,
    p.weight_kg,
    p.launch_date,
    p.discontinued_date,
    (p.discontinued_date IS NULL) AS is_active
FROM src.raw_products p;`
  },
  {
    name: 'dim.promotion.sql',
    content: `-- Kimball promotion dimension
-- Dep: src.raw_promotions
CREATE OR REPLACE TABLE dim.promotion AS
SELECT
    MD5(CAST(p.promotion_id AS VARCHAR)) AS promotion_key,
    p.promotion_id, p.promotion_name,
    p.promo_type, p.discount_type,
    p.discount_value,
    p.start_date, p.end_date,
    DATEDIFF('day', p.start_date, p.end_date) + 1 AS duration_days,
    p.channel, p.target_segment,
    (CURRENT_DATE BETWEEN p.start_date AND p.end_date) AS is_active
FROM src.raw_promotions p;`
  },
  {
    name: 'dim.store.sql',
    content: `-- Kimball store/channel dimension
-- Dep: src.raw_stores
CREATE OR REPLACE TABLE dim.store AS
SELECT
    MD5(CAST(s.store_id AS VARCHAR))  AS store_key,
    s.store_id, s.store_name,
    s.store_type, s.region,
    s.city, s.state, s.country,
    s.open_date, s.close_date,
    s.sqft,
    CASE
        WHEN s.store_type = 'ONLINE'     THEN 'Digital'
        WHEN s.store_type = 'FLAGSHIP'   THEN 'Large Format'
        WHEN s.store_type = 'OUTLET'     THEN 'Discount'
        ELSE                                  'Standard'
    END AS store_category,
    (s.close_date IS NULL) AS is_active
FROM src.raw_stores s;`
  },
  {
    name: 'fact.returns.sql',
    content: `-- Kimball returns fact table
-- Deps: src.raw_transactions, dim.customer, dim.product, dim.store, dim.date
CREATE OR REPLACE TABLE fact.returns AS
SELECT
    dc.customer_key,
    dp.product_key,
    ds.store_key,
    dd.date_key,
    t.transaction_id,
    t.order_id,
    t.channel,
    t.quantity                                           AS returned_qty,
    ROUND(t.quantity * t.unit_price, 2)                  AS returned_gross_value,
    ROUND(t.quantity * t.unit_price - t.discount_amt, 2) AS returned_net_value,
    ROUND(t.quantity * dp.cost_price, 2)                 AS returned_cogs,
    t.transaction_ts AS return_ts
FROM src.raw_transactions t
JOIN dim.customer  dc  ON t.customer_id          = dc.customer_id AND dc.is_current
JOIN dim.product   dp  ON t.product_id           = dp.product_id
JOIN dim.store     ds  ON t.store_id             = ds.store_id
JOIN dim.date      dd  ON DATE(t.transaction_ts) = dd.full_date
WHERE t.return_flag = TRUE;`
  },
  {
    name: 'fact.sales.sql',
    content: `-- Kimball central sales fact table — star join across all dimensions
-- Deps: src.raw_transactions, dim.customer, dim.product, dim.store, dim.date, dim.promotion
CREATE OR REPLACE TABLE fact.sales AS
SELECT
    dc.customer_key,
    dp.product_key,
    ds.store_key,
    dd.date_key,
    COALESCE(dpr.promotion_key, 'NO_PROMO')              AS promotion_key,
    t.transaction_id, t.order_id, t.channel, t.payment_method,
    t.quantity,
    t.unit_price,
    t.discount_amt,
    ROUND(t.quantity * t.unit_price, 2)                    AS gross_revenue,
    ROUND(t.quantity * t.unit_price - t.discount_amt, 2)   AS net_revenue,
    ROUND(t.quantity * dp.cost_price, 2)                   AS cogs,
    ROUND(t.quantity * t.unit_price - t.discount_amt
          - t.quantity * dp.cost_price, 2)                 AS gross_profit,
    t.transaction_ts
FROM src.raw_transactions t
JOIN dim.customer   dc  ON t.customer_id  = dc.customer_id  AND dc.is_current
JOIN dim.product    dp  ON t.product_id   = dp.product_id
JOIN dim.store      ds  ON t.store_id     = ds.store_id
JOIN dim.date       dd  ON DATE(t.transaction_ts) = dd.full_date
LEFT JOIN dim.promotion dpr ON t.promotion_id = dpr.promotion_id
WHERE t.return_flag = FALSE;`
  },
  {
    name: 'rpt.customer_360.sql',
    content: `-- Report: 360° customer view — purchase history, returns, LTV
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
    COALESCE(cs.total_orders, 0)        AS total_orders,
    COALESCE(cs.total_units, 0)         AS total_units,
    COALESCE(cs.total_net_revenue, 0)   AS total_net_revenue,
    COALESCE(cs.total_gross_profit, 0)  AS total_gross_profit,
    cs.last_purchase_date,
    cs.first_purchase_date,
    DATEDIFF('day', cs.last_purchase_date, CURRENT_DATE) AS days_since_last_purchase,
    COALESCE(cr.total_returns, 0)        AS total_returns,
    COALESCE(cr.total_returned_value, 0) AS total_returned_value,
    ROUND(COALESCE(cr.total_returns, 0) /
          NULLIF(COALESCE(cs.total_orders, 0), 0) * 100, 2) AS return_rate_pct,
    ROUND(COALESCE(cs.total_net_revenue, 0) * 3.0, 2) AS estimated_ltv
FROM dim.customer dc
LEFT JOIN customer_sales   cs ON dc.customer_key = cs.customer_key
LEFT JOIN customer_returns cr ON dc.customer_key = cr.customer_key;`
  },
  {
    name: 'rpt.product_performance.sql',
    content: `-- Report: product performance by store region and period
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
        SUM(fr.returned_qty)       AS ret_qty,
        SUM(fr.returned_net_value) AS ret_value
    FROM fact.returns fr
    GROUP BY 1, 2, 3
)
SELECT
    dd.fiscal_year,
    dd.fiscal_quarter,
    dp.category, dp.sub_category, dp.brand, dp.product_name,
    ds.region, ds.store_type,
    COALESCE(s.sold_qty, 0)      AS sold_qty,
    COALESCE(r.ret_qty, 0)       AS returned_qty,
    COALESCE(s.sold_qty, 0) - COALESCE(r.ret_qty, 0) AS net_qty,
    COALESCE(s.gross_rev, 0)     AS gross_revenue,
    COALESCE(s.net_rev, 0)       AS net_revenue,
    COALESCE(s.gross_profit, 0)  AS gross_profit,
    COALESCE(r.ret_value, 0)     AS return_value,
    ROUND(COALESCE(r.ret_qty, 0) / NULLIF(COALESCE(s.sold_qty, 0), 0) * 100, 2) AS return_rate_pct
FROM sales s
JOIN dim.product dp ON s.product_key = dp.product_key
JOIN dim.store   ds ON s.store_key   = ds.store_key
JOIN dim.date    dd ON s.date_key    = dd.date_key
LEFT JOIN returns r
    ON  s.product_key = r.product_key
    AND s.store_key   = r.store_key
    AND s.date_key    = r.date_key;`
  },
  {
    name: 'rpt.sales_by_channel.sql',
    content: `-- Report: sales performance by channel × customer segment × period
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
    COUNT(DISTINCT fs.transaction_id) AS num_transactions,
    COUNT(DISTINCT dc.customer_key)   AS unique_customers,
    SUM(fs.quantity)                  AS total_units,
    SUM(fs.gross_revenue)             AS gross_revenue,
    SUM(fs.net_revenue)               AS net_revenue,
    SUM(fs.gross_profit)              AS gross_profit,
    AVG(fs.net_revenue)               AS avg_order_value,
    SUM(fs.discount_amt)              AS total_discounts
FROM fact.sales fs
JOIN dim.customer   dc  ON fs.customer_key  = dc.customer_key
JOIN dim.date       dd  ON fs.date_key      = dd.date_key
LEFT JOIN dim.promotion dpr ON fs.promotion_key = dpr.promotion_key
GROUP BY 1, 2, 3, 4, 5, 6, 7;`
  },
  {
    name: 'src.raw_customers.sql',
    content: `-- Source: raw customer records from CRM
CREATE OR REPLACE TABLE src.raw_customers AS
SELECT
    c.customer_id, c.first_name, c.last_name, c.email, c.phone,
    c.address, c.city, c.state, c.zip, c.country,
    c.gender, c.birth_date, c.signup_date, c.loyalty_tier, c._loaded_at
FROM external.crm_db.customers c;`
  },
  {
    name: 'src.raw_products.sql',
    content: `-- Source: raw product catalog from ERP
CREATE OR REPLACE TABLE src.raw_products AS
SELECT
    p.product_id, p.sku, p.product_name, p.brand, p.category, p.sub_category,
    p.cost_price, p.list_price, p.weight_kg, p.launch_date, p.discontinued_date, p._loaded_at
FROM external.erp_db.product_catalog p;`
  },
  {
    name: 'src.raw_promotions.sql',
    content: `-- Source: raw promotion / campaign records
CREATE OR REPLACE TABLE src.raw_promotions AS
SELECT
    p.promotion_id, p.promotion_name, p.promo_type,
    p.discount_type, p.discount_value, p.start_date, p.end_date,
    p.channel, p.target_segment, p._loaded_at
FROM external.marketing_db.promotions p;`
  },
  {
    name: 'src.raw_stores.sql',
    content: `-- Source: store / channel master from retail ops
CREATE OR REPLACE TABLE src.raw_stores AS
SELECT
    s.store_id, s.store_name, s.store_type, s.region, s.city,
    s.state, s.country, s.open_date, s.close_date, s.sqft, s._loaded_at
FROM external.ops_db.stores s;`
  },
  {
    name: 'src.raw_transactions.sql',
    content: `-- Source: raw POS / e-commerce transaction events
CREATE OR REPLACE TABLE src.raw_transactions AS
SELECT
    t.transaction_id, t.order_id, t.customer_id, t.product_id, t.store_id,
    t.promotion_id, t.transaction_ts, t.quantity, t.unit_price, t.discount_amt,
    t.return_flag, t.channel, t.payment_method, t._loaded_at
FROM external.pos_db.transactions t;`
  },
];

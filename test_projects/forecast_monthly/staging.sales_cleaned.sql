-- Silver: cleaned and validated sales transactions
-- Deps: raw.sales_transactions, raw.customers, raw.products
CREATE OR REPLACE TABLE staging.sales_cleaned AS
SELECT
    t.transaction_id,
    t.customer_id,
    t.product_id,
    c.region,
    c.country,
    c.customer_tier,
    p.category,
    p.sub_category,
    p.brand,
    t.quantity,
    t.unit_price,
    t.discount_pct,
    ROUND(t.quantity * t.unit_price * (1 - t.discount_pct / 100), 2) AS net_revenue,
    ROUND(t.quantity * p.cost_price, 2)                               AS cogs,
    t.transaction_date,
    t.store_id,
    t.channel
FROM raw.sales_transactions t
JOIN raw.customers c  ON t.customer_id = c.customer_id
JOIN raw.products  p  ON t.product_id  = p.product_id
WHERE t.transaction_date IS NOT NULL
  AND t.quantity > 0
  AND t.unit_price > 0;

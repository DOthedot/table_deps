-- Kimball central sales fact table — star join across all dimensions
-- Deps: src.raw_transactions, dim.customer, dim.product, dim.store, dim.date, dim.promotion
CREATE OR REPLACE TABLE fact.sales AS
SELECT
    -- Surrogate keys (FK to dims)
    dc.customer_key,
    dp.product_key,
    ds.store_key,
    dd.date_key,
    COALESCE(dpr.promotion_key, 'NO_PROMO')  AS promotion_key,

    -- Degenerate dimensions
    t.transaction_id, t.order_id, t.channel, t.payment_method,

    -- Additive measures
    t.quantity,
    t.unit_price,
    t.discount_amt,
    ROUND(t.quantity * t.unit_price, 2)                AS gross_revenue,
    ROUND(t.quantity * t.unit_price - t.discount_amt, 2) AS net_revenue,
    ROUND(t.quantity * dp.cost_price, 2)               AS cogs,
    ROUND(t.quantity * t.unit_price - t.discount_amt
          - t.quantity * dp.cost_price, 2)             AS gross_profit,

    -- Semi-additive
    t.transaction_ts

FROM src.raw_transactions t
JOIN dim.customer  dc  ON t.customer_id  = dc.customer_id  AND dc.is_current
JOIN dim.product   dp  ON t.product_id   = dp.product_id
JOIN dim.store     ds  ON t.store_id     = ds.store_id
JOIN dim.date      dd  ON DATE(t.transaction_ts) = dd.full_date
LEFT JOIN dim.promotion dpr ON t.promotion_id  = dpr.promotion_id
WHERE t.return_flag = FALSE;

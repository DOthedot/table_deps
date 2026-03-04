-- Kimball returns fact table
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

    -- Return measures
    t.quantity                                         AS returned_qty,
    ROUND(t.quantity * t.unit_price, 2)                AS returned_gross_value,
    ROUND(t.quantity * t.unit_price - t.discount_amt, 2) AS returned_net_value,
    ROUND(t.quantity * dp.cost_price, 2)               AS returned_cogs,

    t.transaction_ts AS return_ts

FROM src.raw_transactions t
JOIN dim.customer  dc  ON t.customer_id          = dc.customer_id AND dc.is_current
JOIN dim.product   dp  ON t.product_id           = dp.product_id
JOIN dim.store     ds  ON t.store_id             = ds.store_id
JOIN dim.date      dd  ON DATE(t.transaction_ts) = dd.full_date
WHERE t.return_flag = TRUE;

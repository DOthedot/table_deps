-- Source: raw POS / e-commerce transaction events
CREATE OR REPLACE TABLE src.raw_transactions AS
SELECT
    t.transaction_id, t.order_id, t.customer_id, t.product_id, t.store_id,
    t.promotion_id, t.transaction_ts, t.quantity, t.unit_price, t.discount_amt,
    t.return_flag, t.channel, t.payment_method, t._loaded_at
FROM external.pos_db.transactions t;

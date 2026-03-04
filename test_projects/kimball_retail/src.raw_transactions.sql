-- Source: raw POS / e-commerce transaction events
CREATE OR REPLACE TABLE src.raw_transactions AS
SELECT
    transaction_id, order_id, customer_id, product_id, store_id,
    promotion_id, transaction_ts, quantity, unit_price, discount_amt,
    return_flag, channel, payment_method, _loaded_at
FROM external.pos_db.transactions;

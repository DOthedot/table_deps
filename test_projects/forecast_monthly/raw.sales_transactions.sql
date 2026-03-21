-- Bronze: raw sales transactions ingested from OLTP source
-- No upstream dependencies within this project
CREATE OR REPLACE TABLE raw.sales_transactions AS
SELECT
    t.transaction_id,
    t.customer_id,
    t.product_id,
    t.quantity,
    t.unit_price,
    t.discount_pct,
    t.transaction_date,
    t.store_id,
    t.channel,
    t._loaded_at
FROM external_source.oltp_db.sales_fact t;

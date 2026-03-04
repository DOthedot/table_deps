-- Bronze: raw sales transactions ingested from OLTP source
-- No upstream dependencies within this project
CREATE OR REPLACE TABLE raw.sales_transactions AS
SELECT
    transaction_id,
    customer_id,
    product_id,
    quantity,
    unit_price,
    discount_pct,
    transaction_date,
    store_id,
    channel,
    _loaded_at
FROM external_source.oltp_db.sales_fact;

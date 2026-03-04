-- Raw landing table: customers from source system
CREATE OR REPLACE TABLE raw.customers AS
SELECT
    customer_id,
    customer_name,
    contact_email,
    region,
    country,
    segment,
    _loaded_at
FROM src.customers_feed;

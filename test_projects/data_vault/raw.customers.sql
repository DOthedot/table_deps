-- Raw landing table: customers from source system
CREATE OR REPLACE TABLE raw.customers AS
SELECT
    c.customer_id,
    c.customer_name,
    c.contact_email,
    c.region,
    c.country,
    c.segment,
    c._loaded_at
FROM src.customers_feed c;

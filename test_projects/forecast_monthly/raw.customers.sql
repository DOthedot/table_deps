-- Bronze: raw customer master data from CRM
CREATE OR REPLACE TABLE raw.customers AS
SELECT
    customer_id,
    first_name,
    last_name,
    email,
    region,
    country,
    signup_date,
    customer_tier,
    _loaded_at
FROM external_source.crm_db.customers;

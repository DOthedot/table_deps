-- Bronze: raw customer master data from CRM
CREATE OR REPLACE TABLE raw.customers AS
SELECT
    c.customer_id,
    c.first_name,
    c.last_name,
    c.email,
    c.region,
    c.country,
    c.signup_date,
    c.customer_tier,
    c._loaded_at
FROM external_source.crm_db.customers c;

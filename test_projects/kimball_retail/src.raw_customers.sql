-- Source: raw customer records from CRM
CREATE OR REPLACE TABLE src.raw_customers AS
SELECT
    customer_id, first_name, last_name, email, phone,
    address, city, state, zip, country,
    gender, birth_date, signup_date, loyalty_tier, _loaded_at
FROM external.crm_db.customers;

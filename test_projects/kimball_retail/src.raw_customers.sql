-- Source: raw customer records from CRM
CREATE OR REPLACE TABLE src.raw_customers AS
SELECT
    c.customer_id, c.first_name, c.last_name, c.email, c.phone,
    c.address, c.city, c.state, c.zip, c.country,
    c.gender, c.birth_date, c.signup_date, c.loyalty_tier, c._loaded_at
FROM external.crm_db.customers c;

-- Data Vault Hub: customer business keys
-- Deps: raw.customers
CREATE OR REPLACE TABLE hub.customer AS
SELECT
    MD5(customer_id)        AS hub_customer_hk,
    customer_id             AS bk_customer_id,
    'CRM'                   AS record_source,
    MIN(_loaded_at)         AS load_dts
FROM raw.customers
GROUP BY 1, 2, 3;

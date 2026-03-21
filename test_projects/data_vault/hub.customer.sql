-- Data Vault Hub: customer business keys
-- Deps: raw.customers
CREATE OR REPLACE TABLE hub.customer AS
SELECT
    MD5(rc.customer_id)     AS hub_customer_hk,
    rc.customer_id          AS bk_customer_id,
    'CRM'                   AS record_source,
    MIN(rc._loaded_at)      AS load_dts
FROM raw.customers rc
GROUP BY rc.customer_id;

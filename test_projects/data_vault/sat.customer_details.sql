-- Data Vault Satellite: customer descriptive attributes (SCD-2 style)
-- Deps: hub.customer, raw.customers
CREATE OR REPLACE TABLE sat.customer_details AS
SELECT
    hc.hub_customer_hk,
    rc.customer_name,
    rc.contact_email,
    rc.region,
    rc.country,
    rc.segment,
    MD5(rc.customer_name || rc.contact_email || rc.region || rc.country || rc.segment) AS row_hash,
    rc._loaded_at AS load_dts,
    'CRM'         AS record_source
FROM raw.customers rc
JOIN hub.customer  hc ON rc.customer_id = hc.bk_customer_id;

-- Data Vault Hub: employee business keys
-- Deps: raw.employees
CREATE OR REPLACE TABLE hub.employee AS
SELECT
    MD5(re.employee_id)     AS hub_employee_hk,
    re.employee_id          AS bk_employee_id,
    'HR'                    AS record_source,
    MIN(re._loaded_at)      AS load_dts
FROM raw.employees re
GROUP BY re.employee_id;

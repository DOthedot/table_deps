-- Data Vault Hub: employee business keys
-- Deps: raw.employees
CREATE OR REPLACE TABLE hub.employee AS
SELECT
    MD5(employee_id)        AS hub_employee_hk,
    employee_id             AS bk_employee_id,
    'HR'                    AS record_source,
    MIN(_loaded_at)         AS load_dts
FROM raw.employees
GROUP BY 1, 2, 3;

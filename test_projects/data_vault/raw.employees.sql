-- Raw landing table: employees from HR system
CREATE OR REPLACE TABLE raw.employees AS
SELECT
    employee_id,
    employee_name,
    department,
    region,
    hire_date,
    _loaded_at
FROM src.employees_feed;

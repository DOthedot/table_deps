-- Raw landing table: employees from HR system
CREATE OR REPLACE TABLE raw.employees AS
SELECT
    e.employee_id,
    e.employee_name,
    e.department,
    e.region,
    e.hire_date,
    e._loaded_at
FROM src.employees_feed e;

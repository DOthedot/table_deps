-- Kimball date dimension — no upstream project dependency
CREATE OR REPLACE TABLE dim.date AS
SELECT
    d.date_key,          -- YYYYMMDD integer surrogate
    d.full_date,
    d.year, d.quarter, d.month, d.month_name,
    d.week_of_year, d.day_of_week, d.day_name,
    d.is_weekend, d.is_holiday, d.fiscal_year,
    d.fiscal_quarter, d.fiscal_month, d.fiscal_week
FROM external.util_db.dim_date d
WHERE d.full_date BETWEEN '2018-01-01' AND '2035-12-31';

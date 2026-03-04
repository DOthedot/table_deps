-- Kimball date dimension — no upstream project dependency
CREATE OR REPLACE TABLE dim.date AS
SELECT
    date_key,          -- YYYYMMDD integer surrogate
    full_date,
    year, quarter, month, month_name,
    week_of_year, day_of_week, day_name,
    is_weekend, is_holiday, fiscal_year,
    fiscal_quarter, fiscal_month, fiscal_week
FROM external.util_db.dim_date
WHERE full_date BETWEEN '2018-01-01' AND '2035-12-31';

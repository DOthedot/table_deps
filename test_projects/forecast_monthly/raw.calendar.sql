-- Bronze: calendar/date dimension (generated, no source dependency)
CREATE OR REPLACE TABLE raw.calendar AS
SELECT
    d.date_id,
    d.full_date,
    d.year,
    d.quarter,
    d.month,
    d.month_name,
    d.week_of_year,
    d.day_of_week,
    d.is_weekend,
    d.is_holiday,
    d.fiscal_year,
    d.fiscal_quarter,
    d.fiscal_month
FROM external_source.util_db.dim_date d
WHERE d.full_date BETWEEN '2020-01-01' AND '2030-12-31';

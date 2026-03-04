-- Bronze: calendar/date dimension (generated, no source dependency)
CREATE OR REPLACE TABLE raw.calendar AS
SELECT
    date_id,
    full_date,
    year,
    quarter,
    month,
    month_name,
    week_of_year,
    day_of_week,
    is_weekend,
    is_holiday,
    fiscal_year,
    fiscal_quarter,
    fiscal_month
FROM external_source.util_db.dim_date
WHERE full_date BETWEEN '2020-01-01' AND '2030-12-31';

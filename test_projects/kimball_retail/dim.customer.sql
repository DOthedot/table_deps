-- Kimball SCD-2 customer dimension
-- Dep: src.raw_customers
CREATE OR REPLACE TABLE dim.customer AS
SELECT
    MD5(CAST(c.customer_id AS VARCHAR) || CAST(c._loaded_at AS VARCHAR)) AS customer_key,
    c.customer_id,
    c.first_name, c.last_name,
    c.email, c.phone,
    c.city, c.state, c.country,
    c.gender,
    DATEDIFF('year', c.birth_date, CURRENT_DATE)     AS age,
    DATEDIFF('year', c.signup_date, CURRENT_DATE)    AS tenure_years,
    c.loyalty_tier,
    CASE
        WHEN c.loyalty_tier = 'PLATINUM' THEN 4
        WHEN c.loyalty_tier = 'GOLD'     THEN 3
        WHEN c.loyalty_tier = 'SILVER'   THEN 2
        ELSE 1
    END AS loyalty_rank,
    TRUE  AS is_current,
    c._loaded_at AS valid_from,
    NULL         AS valid_to
FROM src.raw_customers c;

-- Kimball promotion dimension
-- Dep: src.raw_promotions
CREATE OR REPLACE TABLE dim.promotion AS
SELECT
    MD5(CAST(p.promotion_id AS VARCHAR)) AS promotion_key,
    p.promotion_id, p.promotion_name,
    p.promo_type, p.discount_type,
    p.discount_value,
    p.start_date, p.end_date,
    DATEDIFF('day', p.start_date, p.end_date) + 1 AS duration_days,
    p.channel, p.target_segment,
    (CURRENT_DATE BETWEEN p.start_date AND p.end_date) AS is_active
FROM src.raw_promotions p;

-- Source: raw promotion / campaign records
CREATE OR REPLACE TABLE src.raw_promotions AS
SELECT
    promotion_id, promotion_name, promo_type,
    discount_type, discount_value, start_date, end_date,
    channel, target_segment, _loaded_at
FROM external.marketing_db.promotions;

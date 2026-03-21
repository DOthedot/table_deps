-- Source: raw promotion / campaign records
CREATE OR REPLACE TABLE src.raw_promotions AS
SELECT
    p.promotion_id, p.promotion_name, p.promo_type,
    p.discount_type, p.discount_value, p.start_date, p.end_date,
    p.channel, p.target_segment, p._loaded_at
FROM external.marketing_db.promotions p;

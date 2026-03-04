-- Kimball store/channel dimension
-- Dep: src.raw_stores
CREATE OR REPLACE TABLE dim.store AS
SELECT
    MD5(CAST(s.store_id AS VARCHAR))  AS store_key,
    s.store_id, s.store_name,
    s.store_type, s.region,
    s.city, s.state, s.country,
    s.open_date, s.close_date,
    s.sqft,
    CASE
        WHEN s.store_type = 'ONLINE'     THEN 'Digital'
        WHEN s.store_type = 'FLAGSHIP'   THEN 'Large Format'
        WHEN s.store_type = 'OUTLET'     THEN 'Discount'
        ELSE                                  'Standard'
    END AS store_category,
    (s.close_date IS NULL) AS is_active
FROM src.raw_stores s;

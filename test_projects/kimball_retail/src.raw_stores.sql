-- Source: store / channel master from retail ops
CREATE OR REPLACE TABLE src.raw_stores AS
SELECT
    s.store_id, s.store_name, s.store_type, s.region, s.city,
    s.state, s.country, s.open_date, s.close_date, s.sqft, s._loaded_at
FROM external.ops_db.stores s;

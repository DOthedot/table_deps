-- Source: store / channel master from retail ops
CREATE OR REPLACE TABLE src.raw_stores AS
SELECT
    store_id, store_name, store_type, region, city,
    state, country, open_date, close_date, sqft, _loaded_at
FROM external.ops_db.stores;

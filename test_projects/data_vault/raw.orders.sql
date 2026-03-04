-- Raw landing table: orders from source system
CREATE OR REPLACE TABLE raw.orders AS
SELECT
    order_id,
    customer_id,
    employee_id,
    order_date,
    ship_date,
    ship_region,
    status,
    total_amount,
    _loaded_at
FROM src.orders_feed;

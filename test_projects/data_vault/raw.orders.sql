-- Raw landing table: orders from source system
CREATE OR REPLACE TABLE raw.orders AS
SELECT
    o.order_id,
    o.customer_id,
    o.employee_id,
    o.order_date,
    o.ship_date,
    o.ship_region,
    o.status,
    o.total_amount,
    o._loaded_at
FROM src.orders_feed o;

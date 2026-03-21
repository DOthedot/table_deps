-- Raw landing table: order line items
CREATE OR REPLACE TABLE raw.order_items AS
SELECT
    oi.order_item_id,
    oi.order_id,
    oi.product_id,
    oi.quantity,
    oi.unit_price,
    oi.discount,
    oi._loaded_at
FROM src.order_items_feed oi;

-- Raw landing table: order line items
CREATE OR REPLACE TABLE raw.order_items AS
SELECT
    order_item_id,
    order_id,
    product_id,
    quantity,
    unit_price,
    discount,
    _loaded_at
FROM src.order_items_feed;

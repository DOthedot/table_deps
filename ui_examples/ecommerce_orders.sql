-- E-commerce order fulfilment pipeline
-- Schemas: public, inventory, payments, shipping, analytics
WITH
    active_customers AS (
        SELECT
            c.customer_id,
            c.email,
            c.tier,
            a.country,
            a.region
        FROM public.customers c
        JOIN public.addresses a ON c.default_address_id = a.address_id
        WHERE c.status = 'active'
          AND c.created_at >= '2023-01-01'
    ),
    pending_orders AS (
        SELECT
            o.order_id,
            o.customer_id,
            o.created_at,
            o.total_amount,
            o.currency,
            p.payment_status,
            p.payment_method
        FROM public.orders o
        LEFT JOIN payments.transactions p ON o.order_id = p.order_id
        WHERE o.status IN ('pending', 'processing')
          AND o.created_at >= CURRENT_DATE - INTERVAL '30 days'
    ),
    order_lines AS (
        SELECT
            ol.order_id,
            ol.product_id,
            ol.quantity,
            ol.unit_price,
            ol.quantity * ol.unit_price AS line_total,
            pr.name                     AS product_name,
            pr.category_id,
            inv.warehouse_id,
            inv.available_qty
        FROM public.order_lines ol
        JOIN public.products pr       ON ol.product_id = pr.product_id
        JOIN inventory.stock inv      ON ol.product_id = inv.product_id
    )
SELECT
    ac.customer_id,
    ac.email,
    ac.tier,
    ac.country,
    po.order_id,
    po.created_at,
    po.total_amount,
    po.payment_status,
    ol.product_name,
    ol.quantity,
    ol.line_total,
    ol.available_qty,
    sh.carrier,
    sh.estimated_delivery,
    cat.name AS category_name,
    promo.discount_pct
FROM active_customers ac
JOIN pending_orders po     ON ac.customer_id = po.customer_id
JOIN order_lines ol        ON po.order_id    = ol.order_id
LEFT JOIN shipping.shipments sh   ON po.order_id = sh.order_id
LEFT JOIN public.categories cat   ON ol.category_id = cat.category_id
LEFT JOIN analytics.promotions promo
       ON promo.customer_tier = ac.tier
      AND promo.category_id   = ol.category_id
WHERE EXISTS (
    SELECT 1
    FROM inventory.warehouses w
    WHERE w.warehouse_id = ol.warehouse_id
      AND w.country = ac.country
)
ORDER BY po.created_at DESC, po.total_amount DESC;

-- Regional sales dashboard query
/* Author: analytics team
   FROM fake_comment_table  -- should NOT appear in results
*/
WITH
    region_stats AS (
        SELECT
            r.region_id,
            r.name                          AS region_name,
            SUM(o.total_amount)             AS total_revenue,
            COUNT(DISTINCT o.customer_id)   AS unique_customers
        FROM public.orders o
        JOIN public.regions r ON o.region_id = r.region_id
        WHERE o.status NOT IN ('FROM_CACHE', 'cancelled')
          AND o.created_at >= '2024-01-01'
        GROUP BY r.region_id, r.name
    ),
    top_products AS (
        SELECT
            oi.product_id,
            p.name,
            SUM(oi.quantity)    AS total_qty,
            ROW_NUMBER() OVER (
                PARTITION BY p.category_id
                ORDER BY SUM(oi.quantity) DESC
            ) AS rank_in_category
        FROM `order_items` oi
        JOIN "products" p ON oi.product_id = p.product_id
        GROUP BY oi.product_id, p.name, p.category_id
    )
SELECT
    rs.region_name,
    rs.total_revenue,
    rs.unique_customers,
    tp.name             AS top_product,
    c.name              AS category,
    e.full_name         AS account_manager
FROM region_stats rs
LEFT JOIN top_products tp
       ON tp.rank_in_category = 1
LEFT JOIN analytics.product_categories c
       ON tp.product_id = c.product_id
LEFT JOIN (
    SELECT employee_id, full_name, region_id
    FROM hr.employees
    WHERE role = 'account_manager'
) e ON e.region_id = rs.region_id
WHERE EXISTS (
    SELECT 1
    FROM finance.revenue_targets rt
    WHERE rt.region_id = rs.region_id
      AND rs.total_revenue >= rt.target_amount
)
UNION ALL
SELECT
    'UNASSIGNED'    AS region_name,
    o.total_amount  AS total_revenue,
    1               AS unique_customers,
    NULL, NULL, NULL
FROM public.orders o
WHERE o.region_id IS NULL

ORDER BY total_revenue DESC
LIMIT 100;

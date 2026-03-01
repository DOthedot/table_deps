-- Product analytics: user acquisition → activation → retention funnel
-- Schemas: events, users, product, marketing, reporting
WITH
    signups AS (
        SELECT
            u.user_id,
            u.email,
            u.signup_source,
            u.created_at                    AS signup_ts,
            c.campaign_id,
            c.channel,
            c.utm_medium
        FROM users.accounts u
        LEFT JOIN marketing.attribution c ON u.user_id = c.user_id
        WHERE u.created_at >= '2024-01-01'
    ),
    first_actions AS (
        SELECT
            e.user_id,
            MIN(e.occurred_at)              AS first_action_ts,
            COUNT(*)                        AS total_events_d1,
            MAX(f.feature_name)             AS first_feature_used
        FROM events.user_events e
        JOIN product.features f ON e.feature_id = f.feature_id
        WHERE e.event_type = 'feature_use'
          AND e.occurred_at < (
              SELECT MIN(occurred_at) + INTERVAL '1 day'
              FROM events.user_events ie
              WHERE ie.user_id = e.user_id
          )
        GROUP BY e.user_id
    ),
    retention AS (
        SELECT
            s.user_id,
            COUNT(DISTINCT DATE_TRUNC('week', e.occurred_at)) AS active_weeks,
            MAX(e.occurred_at)                                AS last_seen_ts
        FROM signups s
        JOIN events.user_events e ON s.user_id = e.user_id
        WHERE e.occurred_at BETWEEN s.signup_ts AND s.signup_ts + INTERVAL '90 days'
        GROUP BY s.user_id
    ),
    revenue AS (
        SELECT
            sub.user_id,
            sub.plan_id,
            sub.mrr,
            pl.plan_name,
            pl.tier
        FROM billing.subscriptions sub
        JOIN product.plans pl ON sub.plan_id = pl.plan_id
        WHERE sub.status = 'active'
    )
SELECT
    sg.user_id,
    sg.email,
    sg.signup_source,
    sg.channel,
    sg.utm_medium,
    sg.signup_ts,
    fa.first_action_ts,
    EXTRACT(EPOCH FROM (fa.first_action_ts - sg.signup_ts)) / 3600 AS hours_to_activate,
    fa.total_events_d1,
    fa.first_feature_used,
    rt.active_weeks,
    rt.last_seen_ts,
    rv.plan_name,
    rv.tier,
    rv.mrr,
    seg.segment_name,
    seg.lifecycle_stage
FROM signups sg
LEFT JOIN first_actions fa   ON sg.user_id = fa.user_id
LEFT JOIN retention rt       ON sg.user_id = rt.user_id
LEFT JOIN revenue rv         ON sg.user_id = rv.user_id
LEFT JOIN reporting.user_segments seg ON sg.user_id = seg.user_id
WHERE sg.signup_source IS NOT NULL

UNION ALL

SELECT
    ga.anonymous_id             AS user_id,
    NULL                        AS email,
    ga.traffic_source           AS signup_source,
    ga.channel,
    ga.utm_medium,
    ga.session_start            AS signup_ts,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    'anonymous'                 AS segment_name,
    'visitor'                   AS lifecycle_stage
FROM marketing.guest_sessions ga
WHERE ga.session_start >= '2024-01-01'

ORDER BY signup_ts DESC;

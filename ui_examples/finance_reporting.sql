-- Finance: multi-entity P&L consolidation with FX conversion
-- Schemas: finance, gl, fx, audit, reporting
WITH
    chart_of_accounts AS (
        SELECT
            a.account_id,
            a.account_code,
            a.account_name,
            a.account_type,    -- ASSET / LIABILITY / REVENUE / EXPENSE / EQUITY
            a.parent_account_id,
            a.is_control_account,
            grp.group_name,
            grp.pl_line
        FROM gl.accounts a
        JOIN gl.account_groups grp ON a.group_id = grp.group_id
        WHERE a.is_active = true
    ),
    journal_lines AS (
        SELECT
            jl.line_id,
            jl.journal_id,
            jl.account_id,
            jl.entity_id,
            jl.debit_amount,
            jl.credit_amount,
            jl.currency,
            jl.period_date,
            j.source_system,
            j.is_reversing,
            j.approved_by
        FROM gl.journal_lines jl
        JOIN gl.journals j ON jl.journal_id = j.journal_id
        WHERE j.status = 'posted'
          AND jl.period_date BETWEEN '2024-01-01' AND '2024-12-31'
    ),
    fx_converted AS (
        SELECT
            jl.line_id,
            jl.account_id,
            jl.entity_id,
            jl.period_date,
            jl.debit_amount  * COALESCE(fx.rate, 1) AS debit_usd,
            jl.credit_amount * COALESCE(fx.rate, 1) AS credit_usd,
            jl.source_system
        FROM journal_lines jl
        LEFT JOIN fx.exchange_rates fx
               ON fx.from_currency = jl.currency
              AND fx.to_currency   = 'USD'
              AND fx.rate_date     = DATE_TRUNC('month', jl.period_date)
    ),
    entity_rollup AS (
        SELECT
            fc.entity_id,
            fc.account_id,
            DATE_TRUNC('month', fc.period_date) AS period_month,
            SUM(fc.debit_usd - fc.credit_usd)   AS net_movement_usd
        FROM fx_converted fc
        GROUP BY fc.entity_id, fc.account_id, DATE_TRUNC('month', fc.period_date)
    )
SELECT
    ent.entity_name,
    ent.country,
    ent.consolidation_group,
    coa.account_code,
    coa.account_name,
    coa.account_type,
    coa.pl_line,
    er.period_month,
    er.net_movement_usd,
    SUM(er.net_movement_usd) OVER (
        PARTITION BY ent.entity_id, coa.account_id
        ORDER BY er.period_month
    ) AS ytd_balance_usd,
    bud.budget_amount_usd,
    er.net_movement_usd - COALESCE(bud.budget_amount_usd, 0) AS variance_usd,
    al.last_reviewed_at,
    al.reviewed_by
FROM entity_rollup er
JOIN chart_of_accounts coa ON er.account_id = coa.account_id
JOIN finance.entities ent  ON er.entity_id  = ent.entity_id
LEFT JOIN finance.budgets bud
       ON bud.entity_id   = er.entity_id
      AND bud.account_id  = er.account_id
      AND bud.period_month = er.period_month
LEFT JOIN audit.account_log al
       ON al.entity_id    = er.entity_id
      AND al.account_id   = er.account_id
WHERE coa.account_type IN ('REVENUE', 'EXPENSE')
  AND ent.consolidation_group IS NOT NULL

UNION ALL

SELECT
    'INTERCOMPANY_ELIM'         AS entity_name,
    NULL, NULL,
    ic.account_code,
    ic.description              AS account_name,
    'ELIMINATION'               AS account_type,
    ic.pl_line,
    ic.period_month,
    ic.elimination_amount       AS net_movement_usd,
    NULL, NULL, NULL, NULL, NULL
FROM finance.intercompany_eliminations ic
WHERE ic.period_month BETWEEN '2024-01-01' AND '2024-12-31'

ORDER BY consolidation_group, entity_name, period_month, account_code;

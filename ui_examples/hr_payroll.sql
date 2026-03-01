-- HR payroll & headcount report
-- Schemas: hr, finance, compliance, org
WITH
    org_tree AS (
        SELECT
            e.employee_id,
            e.full_name,
            e.manager_id,
            e.department_id,
            e.job_grade,
            e.hire_date,
            d.name  AS department_name,
            d.cost_centre
        FROM hr.employees e
        JOIN hr.departments d ON e.department_id = d.department_id
        WHERE e.status = 'active'
    ),
    current_salaries AS (
        SELECT
            s.employee_id,
            s.base_salary,
            s.currency,
            s.effective_date,
            b.bonus_pct,
            b.target_bonus
        FROM hr.salaries s
        LEFT JOIN finance.bonus_plans b ON s.employee_id = b.employee_id
            AND b.plan_year = EXTRACT(YEAR FROM CURRENT_DATE)
        WHERE s.end_date IS NULL
    ),
    leave_summary AS (
        SELECT
            employee_id,
            SUM(CASE WHEN leave_type = 'annual'  THEN days_taken ELSE 0 END) AS annual_taken,
            SUM(CASE WHEN leave_type = 'sick'    THEN days_taken ELSE 0 END) AS sick_taken,
            SUM(CASE WHEN leave_type = 'unpaid'  THEN days_taken ELSE 0 END) AS unpaid_taken
        FROM hr.leave_records
        WHERE EXTRACT(YEAR FROM start_date) = EXTRACT(YEAR FROM CURRENT_DATE)
        GROUP BY employee_id
    )
SELECT
    ot.employee_id,
    ot.full_name,
    ot.department_name,
    ot.job_grade,
    ot.hire_date,
    cs.base_salary,
    cs.currency,
    cs.bonus_pct,
    cs.target_bonus,
    ls.annual_taken,
    ls.sick_taken,
    ls.unpaid_taken,
    mgr.full_name       AS manager_name,
    loc.city            AS office_city,
    loc.country         AS office_country,
    comp.classification AS compliance_band
FROM org_tree ot
LEFT JOIN current_salaries cs   ON ot.employee_id = cs.employee_id
LEFT JOIN leave_summary ls      ON ot.employee_id = ls.employee_id
LEFT JOIN hr.employees mgr      ON ot.manager_id  = mgr.employee_id
LEFT JOIN org.office_locations loc
       ON ot.department_id = loc.department_id
LEFT JOIN compliance.salary_bands comp
       ON ot.job_grade     = comp.job_grade
      AND cs.base_salary  BETWEEN comp.min_salary AND comp.max_salary

UNION ALL

SELECT
    c.contractor_id,
    c.full_name,
    c.department_name,
    'CONTRACTOR'        AS job_grade,
    c.start_date        AS hire_date,
    c.daily_rate * 260  AS base_salary,
    c.currency,
    NULL, NULL, NULL, NULL, NULL,
    NULL                AS manager_name,
    c.location          AS office_city,
    c.country           AS office_country,
    'EXTERNAL'          AS compliance_band
FROM hr.contractors c

ORDER BY department_name, full_name;

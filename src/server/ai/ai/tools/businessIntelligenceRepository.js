"use strict";

const { queryRows, queryOne } = require("../../../db/query");

function authCtx(tenantId, userId, role) {
  return { tenantId, userId: userId || "ai-tool", role: role || "shop_admin" };
}

function safeNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function buildPeriodFilter(sql, params, period) {
  if (!period) return { sql, params };
  const p = period.toLowerCase().trim();
  const now = new Date();

  if (p === "today") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start.getTime() + 86400000);
    sql += ` AND state->>'performedAt' >= $${params.length + 1} AND state->>'performedAt' < $${params.length + 2}`;
    params.push(start.toISOString(), end.toISOString());
  } else if (p === "yesterday") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
    const end = new Date(start.getTime() + 86400000);
    sql += ` AND state->>'performedAt' >= $${params.length + 1} AND state->>'performedAt' < $${params.length + 2}`;
    params.push(start.toISOString(), end.toISOString());
  } else if (p === "this_week") {
    const day = now.getUTCDay();
    const diff = now.getUTCDate() - day + (day === 0 ? -6 : 1);
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), diff));
    const end = new Date(start.getTime() + 7 * 86400000);
    sql += ` AND state->>'performedAt' >= $${params.length + 1} AND state->>'performedAt' < $${params.length + 2}`;
    params.push(start.toISOString(), end.toISOString());
  } else if (p === "this_month") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    sql += ` AND state->>'performedAt' >= $${params.length + 1} AND state->>'performedAt' < $${params.length + 2}`;
    params.push(start.toISOString(), end.toISOString());
  } else if (p === "last_month") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    sql += ` AND state->>'performedAt' >= $${params.length + 1} AND state->>'performedAt' < $${params.length + 2}`;
    params.push(start.toISOString(), end.toISOString());
  } else if (p === "this_year" || p === "ytd" || p === "year to date") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
    sql += ` AND state->>'performedAt' >= $${params.length + 1} AND state->>'performedAt' < $${params.length + 2}`;
    params.push(start.toISOString(), end.toISOString());
  }
  return { sql, params };
}

function buildExpensePeriodFilter(sql, params, period) {
  if (!period) return { sql, params };
  const p = period.toLowerCase().trim();
  const now = new Date();

  if (p === "today") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start.getTime() + 86400000);
    sql += ` AND state->>'expenseDate' >= $${params.length + 1} AND state->>'expenseDate' < $${params.length + 2}`;
    params.push(start.toISOString(), end.toISOString());
  } else if (p === "this_month") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    sql += ` AND state->>'expenseDate' >= $${params.length + 1} AND state->>'expenseDate' < $${params.length + 2}`;
    params.push(start.toISOString(), end.toISOString());
  } else if (p === "last_month") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    sql += ` AND state->>'expenseDate' >= $${params.length + 1} AND state->>'expenseDate' < $${params.length + 2}`;
    params.push(start.toISOString(), end.toISOString());
  } else if (p === "this_year" || p === "ytd") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
    sql += ` AND state->>'expenseDate' >= $${params.length + 1} AND state->>'expenseDate' < $${params.length + 2}`;
    params.push(start.toISOString(), end.toISOString());
  }
  return { sql, params };
}

async function getRevenueSummary({ tenantId, period, groupBy }) {
  const ctx = authCtx(tenantId);
  let sql = `
    SELECT
      COALESCE(SUM((state->>'price')::numeric), 0) AS total_revenue,
      COUNT(*)::int AS transaction_count,
      COALESCE(AVG((state->>'price')::numeric), 0) AS average_ticket
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
  `;
  const params = [tenantId];

  const pf = buildPeriodFilter(sql, params, period);
  sql = pf.sql;

  const stats = await queryOne(ctx, sql, params) || {};

  let dailyBreakdown = [];
  if (groupBy === "day" || groupBy === "week" || groupBy === "month") {
    const groupExpr = groupBy === "day"
      ? "DATE(state->>'performedAt')"
      : groupBy === "week"
        ? "DATE_TRUNC('week', (state->>'performedAt')::timestamp)"
        : "DATE_TRUNC('month', (state->>'performedAt')::timestamp)";
    let breakSql = `
      SELECT ${groupExpr} AS period_label,
        COALESCE(SUM((state->>'price')::numeric), 0) AS revenue,
        COUNT(*)::int AS transactions
      FROM app.runtime_state,
      jsonb_array_elements(state->'serviceRecords') AS state
      WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    `;
    const breakParams = [tenantId];
    const bpf = buildPeriodFilter(breakSql, breakParams, period);
    breakSql = bpf.sql;
    breakSql += ` GROUP BY period_label ORDER BY period_label`;
    dailyBreakdown = await queryRows(ctx, breakSql, breakParams);
  }

  return {
    period,
    total: safeNum(stats.total_revenue),
    transactionCount: safeNum(stats.transaction_count),
    averageTicket: safeNum(stats.average_ticket),
    breakdown: dailyBreakdown,
  };
}

async function getRevenueTrends({ tenantId, period, comparison }) {
  const ctx = authCtx(tenantId);
  const now = new Date();
  const currentStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const currentEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevEnd = currentStart;

  const sql = `
    WITH current AS (
      SELECT COALESCE(SUM((state->>'price')::numeric), 0) AS revenue
      FROM app.runtime_state,
      jsonb_array_elements(state->'serviceRecords') AS state
      WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
        AND state->>'performedAt' >= $2 AND state->>'performedAt' < $3
    ),
    previous AS (
      SELECT COALESCE(SUM((state->>'price')::numeric), 0) AS revenue
      FROM app.runtime_state,
      jsonb_array_elements(state->'serviceRecords') AS state
      WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
        AND state->>'performedAt' >= $4 AND state->>'performedAt' < $5
    )
    SELECT
      current.revenue AS current_revenue,
      previous.revenue AS previous_revenue,
      CASE WHEN previous.revenue > 0
        THEN ((current.revenue - previous.revenue) / previous.revenue) * 100
        ELSE NULL
      END AS change_pct
    FROM current, previous
  `;

  const result = await queryOne(ctx, sql, [tenantId, currentStart.toISOString(), currentEnd.toISOString(), prevStart.toISOString(), prevEnd.toISOString()]) || {};

  return {
    period,
    currentRevenue: safeNum(result.current_revenue),
    previousRevenue: safeNum(result.previous_revenue),
    changePercent: result.change_pct != null ? Math.round(safeNum(result.change_pct) * 100) / 100 : null,
    direction: result.change_pct > 0 ? "up" : result.change_pct < 0 ? "down" : "flat",
  };
}

async function getExpenseAnalysis({ tenantId, period, category }) {
  const ctx = authCtx(tenantId);
  let sql = `
    SELECT
      COALESCE(SUM((state->>'amount')::numeric), 0) AS total_expenses,
      COUNT(*)::int AS expense_count
    FROM app.runtime_state,
    jsonb_array_elements(state->'expenses') AS state
    WHERE state->>'tenantId' = $1
  `;
  const params = [tenantId];

  const pf = buildExpensePeriodFilter(sql, params, period);
  sql = pf.sql;
  params.length = 0;
  params.push(tenantId);
  buildExpensePeriodFilter(sql, params, period);

  if (category) {
    sql += ` AND state->>'category' = $${params.length + 1}`;
    params.push(category);
  }

  const stats = await queryOne(ctx, sql, params) || {};

  const catSql = `
    SELECT state->>'category' AS category,
      COALESCE(SUM((state->>'amount')::numeric), 0) AS total,
      COUNT(*)::int AS count
    FROM app.runtime_state,
    jsonb_array_elements(state->'expenses') AS state
    WHERE state->>'tenantId' = $1
    GROUP BY state->>'category'
    ORDER BY total DESC
  `;
  const byCategory = await queryRows(ctx, catSql, [tenantId]);

  return {
    period,
    total: safeNum(stats.total_expenses),
    count: safeNum(stats.expense_count),
    byCategory,
  };
}

async function getUnusualExpenses({ tenantId, period, threshold }) {
  const ctx = authCtx(tenantId);
  const t = threshold || 2;
  const sql = `
    WITH stats AS (
      SELECT AVG((state->>'amount')::numeric) AS avg_amount,
             STDDEV((state->>'amount')::numeric) AS stddev_amount
      FROM app.runtime_state,
      jsonb_array_elements(state->'expenses') AS state
      WHERE state->>'tenantId' = $1
    )
    SELECT state->>'id' AS id,
      state->>'category' AS category,
      state->>'description' AS description,
      (state->>'amount')::numeric AS amount,
      state->>'expenseDate' AS expense_date,
      state->>'createdBy' AS created_by
    FROM app.runtime_state,
    jsonb_array_elements(state->'expenses') AS state,
    stats
    WHERE state->>'tenantId' = $1
      AND stats.stddev_amount > 0
      AND ABS((state->>'amount')::numeric - stats.avg_amount) > stats.stddev_amount * $2
    ORDER BY amount DESC
  `;

  const rows = await queryRows(ctx, sql, [tenantId, t]);
  return { unusualExpenses: rows };
}

async function getProfitAnalysis({ tenantId, period }) {
  const ctx = authCtx(tenantId);

  const revSql = `
    SELECT COALESCE(SUM((state->>'price')::numeric), 0) AS revenue
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
  `;
  const expSql = `
    SELECT COALESCE(SUM((state->>'amount')::numeric), 0) AS expenses
    FROM app.runtime_state,
    jsonb_array_elements(state->'expenses') AS state
    WHERE state->>'tenantId' = $1
  `;

  const revenue = await queryOne(ctx, revSql, [tenantId]) || {};
  const expenses = await queryOne(ctx, expSql, [tenantId]) || {};

  const totalRevenue = safeNum(revenue.revenue);
  const totalExpenses = safeNum(expenses.expenses);
  const grossProfit = totalRevenue;
  const netProfit = totalRevenue - totalExpenses;
  const grossMargin = totalRevenue > 0 ? 1 : 0;
  const netMargin = totalRevenue > 0 ? netProfit / totalRevenue : 0;

  return {
    period,
    totalRevenue,
    totalExpenses,
    grossProfit,
    netProfit,
    grossMargin: Math.round(grossMargin * 10000) / 10000,
    netMargin: Math.round(netMargin * 10000) / 10000,
  };
}

async function getCustomerIntelligence({ tenantId, period }) {
  const ctx = authCtx(tenantId);

  const sql = `
    SELECT
      state->>'customerId' AS customer_id,
      COUNT(*)::int AS visit_count,
      COALESCE(SUM((state->>'price')::numeric), 0) AS total_spent,
      MIN(state->>'performedAt') AS first_visit,
      MAX(state->>'performedAt') AS last_visit
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    GROUP BY state->>'customerId'
    ORDER BY total_spent DESC
  `;

  const rows = await queryRows(ctx, sql, [tenantId]);
  const totalCustomers = rows.length;
  const repeatCustomers = rows.filter((r) => r.visit_count > 1).length;
  const activeCustomers = rows.filter((r) => {
    const lastVisit = new Date(r.last_visit);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    return lastVisit >= thirtyDaysAgo;
  }).length;
  const totalRevenue = rows.reduce((s, r) => s + safeNum(r.total_spent), 0);

  return {
    period,
    totalCustomers,
    repeatCustomers,
    newCustomers: 0,
    activeCustomers,
    repeatRate: totalCustomers > 0 ? repeatCustomers / totalCustomers : 0,
    totalCustomerRevenue: totalRevenue,
    averageRevenuePerCustomer: totalCustomers > 0 ? totalRevenue / totalCustomers : 0,
    topCustomers: rows.slice(0, 10),
  };
}

async function getServiceIntelligence({ tenantId, period }) {
  const ctx = authCtx(tenantId);

  const sql = `
    SELECT
      COALESCE(state->>'serviceName', 'Unknown') AS name,
      COUNT(*)::int AS count,
      COALESCE(SUM((state->>'price')::numeric), 0) AS revenue,
      COALESCE(AVG((state->>'price')::numeric), 0) AS avg_price
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    GROUP BY state->>'serviceName'
    ORDER BY revenue DESC
  `;

  const rows = await queryRows(ctx, sql, [tenantId]);
  return {
    period,
    services: rows.map((r) => ({
      name: r.name,
      count: safeNum(r.count),
      revenue: safeNum(r.revenue),
      avgPrice: safeNum(r.avg_price),
    })),
  };
}

async function getSalesSummary({ tenantId, period }) {
  const ctx = authCtx(tenantId);
  let sql = `
    SELECT
      COUNT(*)::int AS total_transactions,
      COALESCE(SUM((state->>'price')::numeric), 0) AS total_revenue,
      COALESCE(AVG((state->>'price')::numeric), 0) AS average_ticket
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
  `;
  const params = [tenantId];
  const pf = buildPeriodFilter(sql, params, period);
  sql = pf.sql;

  const stats = await queryOne(ctx, sql, params) || {};

  return {
    period,
    totalTransactions: safeNum(stats.total_transactions),
    totalRevenue: safeNum(stats.total_revenue),
    averageTicket: safeNum(stats.average_ticket),
  };
}

async function getStaffPerformance({ tenantId, period }) {
  const ctx = authCtx(tenantId);

  const sql = `
    SELECT
      state->>'staffId' AS staff_id,
      COUNT(*)::int AS services_rendered,
      COALESCE(SUM((state->>'price')::numeric), 0) AS revenue_generated,
      COALESCE(SUM((state->>'commissionAmount')::numeric), 0) AS total_commission
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    GROUP BY state->>'staffId'
    ORDER BY revenue_generated DESC
  `;

  const rows = await queryRows(ctx, sql, [tenantId]);

  const staffNames = await queryRows(ctx, `
    SELECT id, state->>'fullName' AS full_name
    FROM app.runtime_state,
    jsonb_array_elements(state->'users') AS state
    WHERE state->>'tenantId' = $1
  `, [tenantId]);
  const nameMap = {};
  for (const s of staffNames) nameMap[s.id] = s.full_name;

  return {
    period,
    staff: rows.map((r) => ({
      staffId: r.staff_id,
      name: nameMap[r.staff_id] || "Unknown",
      servicesRendered: safeNum(r.services_rendered),
      revenueGenerated: safeNum(r.revenue_generated),
      totalCommission: safeNum(r.total_commission),
    })),
  };
}

async function getDetectedRisks({ tenantId, period }) {
  const ctx = authCtx(tenantId);

  const revSql = `
    SELECT COALESCE(SUM((state->>'price')::numeric), 0) AS revenue
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
  `;
  const expSql = `
    SELECT COALESCE(SUM((state->>'amount')::numeric), 0) AS expenses
    FROM app.runtime_state,
    jsonb_array_elements(state->'expenses') AS state
    WHERE state->>'tenantId' = $1
  `;
  const custSql = `
    SELECT COUNT(DISTINCT state->>'customerId') AS customer_count
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
  `;

  const [revenue, expenses, customers] = await Promise.all([
    queryOne(ctx, revSql, [tenantId]),
    queryOne(ctx, expSql, [tenantId]),
    queryOne(ctx, custSql, [tenantId]),
  ]);

  const totalRevenue = safeNum(revenue?.revenue);
  const totalExpenses = safeNum(expenses?.expenses);
  const totalCustomers = safeNum(customers?.customer_count);
  const risks = [];

  if (totalRevenue === 0) {
    risks.push({
      type: "no_revenue",
      severity: "critical",
      message: "No revenue recorded. The business may not be operational.",
      action: "Verify that services are being recorded and staff are entering sales.",
      priority: "critical",
    });
  } else if (totalRevenue < 10000) {
    risks.push({
      type: "low_revenue",
      severity: "warning",
      message: `Revenue is low at KES ${totalRevenue.toLocaleString()}.`,
      action: "Review pricing, marketing, and service offerings to boost revenue.",
      priority: "high",
    });
  }

  if (totalRevenue > 0 && totalExpenses / totalRevenue > 0.8) {
    risks.push({
      type: "high_expense_ratio",
      severity: "warning",
      message: `Expenses (KES ${totalExpenses.toLocaleString()}) consume ${Math.round((totalExpenses / totalRevenue) * 100)}% of revenue.`,
      action: "Identify and cut unnecessary expenses to protect profitability.",
      priority: "high",
    });
  }

  if (totalCustomers === 0) {
    risks.push({
      type: "no_customers",
      severity: "critical",
      message: "No customer activity detected.",
      action: "Focus on customer acquisition and retention strategies immediately.",
      priority: "critical",
    });
  }

  return { risks };
}

async function getCashFlowAnalysis({ tenantId, period }) {
  const ctx = authCtx(tenantId);

  const inflowSql = `
    SELECT COALESCE(SUM((state->>'price')::numeric), 0) AS inflow
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
  `;
  const outflowSql = `
    SELECT COALESCE(SUM((state->>'amount')::numeric), 0) AS outflow
    FROM app.runtime_state,
    jsonb_array_elements(state->'expenses') AS state
    WHERE state->>'tenantId' = $1
  `;

  const [inflow, outflow] = await Promise.all([
    queryOne(ctx, inflowSql, [tenantId]),
    queryOne(ctx, outflowSql, [tenantId]),
  ]);

  const totalInflow = safeNum(inflow?.inflow);
  const totalOutflow = safeNum(outflow?.outflow);

  return {
    period,
    totalInflow,
    totalOutflow,
    netCashFlow: totalInflow - totalOutflow,
  };
}

async function getOpportunities({ tenantId, period }) {
  const ctx = authCtx(tenantId);
  const opportunities = [];

  const svcSql = `
    SELECT state->>'serviceName' AS name,
      COUNT(*)::int AS count,
      COALESCE(SUM((state->>'price')::numeric), 0) AS revenue
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    GROUP BY state->>'serviceName'
    ORDER BY count DESC
  `;
  const services = await queryRows(ctx, svcSql, [tenantId]);

  if (services.length > 0) {
    const top = services[0];
    opportunities.push({
      type: "top_service_promotion",
      severity: "info",
      message: `"${top.name}" is the most popular service with ${top.count} bookings. Consider promoting it further.`,
      action: `Feature "${top.name}" in marketing materials and train staff to upsell it.`,
      priority: "medium",
    });

    if (services.length > 1) {
      const bottom = services[services.length - 1];
      opportunities.push({
        type: "underperforming_service",
        severity: "info",
        message: `"${bottom.name}" has only ${bottom.count} booking(s). Review pricing or visibility.`,
        action: `Evaluate if "${bottom.name}" needs repositioning, a price change, or discontinuation.`,
        priority: "low",
      });
    }
  }

  const custSql = `
    SELECT state->>'customerId' AS customer_id,
      COUNT(*)::int AS visit_count,
      COALESCE(SUM((state->>'price')::numeric), 0) AS total_spent
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    GROUP BY state->>'customerId'
    HAVING COUNT(*) = 1
    ORDER BY total_spent DESC
    LIMIT 10
  `;
  const oneTimers = await queryRows(ctx, custSql, [tenantId]);
  if (oneTimers.length > 0) {
    opportunities.push({
      type: "repeat_customer_conversion",
      severity: "info",
      message: `${oneTimers.length} customer(s) have only visited once. Converting them to repeat customers could significantly boost revenue.`,
      action: "Implement a loyalty program or follow-up campaign to encourage repeat visits.",
      priority: "medium",
    });
  }

  return { opportunities };
}

// ── New: Revenue Breakdown by Employee ────────────────────────────────────

async function getRevenueByEmployee({ tenantId, period }) {
  const ctx = authCtx(tenantId);
  const sql = `
    SELECT
      state->>'staffId' AS employee_id,
      state->>'staffName' AS employee_name,
      COUNT(*)::int AS transaction_count,
      COALESCE(SUM((state->>'price')::numeric), 0) AS revenue
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    GROUP BY state->>'staffId', state->>'staffName'
    ORDER BY revenue DESC
  `;
  const rows = await queryRows(ctx, sql, [tenantId]);
  return { period, employees: rows.map(r => ({ employeeId: r.employee_id, name: r.employee_name || 'Unknown', transactionCount: safeNum(r.transaction_count), revenue: safeNum(r.revenue) })) };
}

async function getRevenueByService({ tenantId, period }) {
  const ctx = authCtx(tenantId);
  const sql = `
    SELECT
      state->>'serviceName' AS service_name,
      COUNT(*)::int AS transaction_count,
      COALESCE(SUM((state->>'price')::numeric), 0) AS revenue,
      COALESCE(AVG((state->>'price')::numeric), 0) AS avg_price
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    GROUP BY state->>'serviceName'
    ORDER BY revenue DESC
  `;
  const rows = await queryRows(ctx, sql, [tenantId]);
  return { period, services: rows.map(r => ({ serviceName: r.service_name, transactionCount: safeNum(r.transaction_count), revenue: safeNum(r.revenue), avgPrice: safeNum(r.avg_price) })) };
}

async function getRevenueByPaymentMethod({ tenantId, period }) {
  const ctx = authCtx(tenantId);
  const sql = `
    SELECT
      COALESCE(state->>'paymentMethod', 'Unknown') AS payment_method,
      COUNT(*)::int AS transaction_count,
      COALESCE(SUM((state->>'price')::numeric), 0) AS revenue
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    GROUP BY state->>'paymentMethod'
    ORDER BY revenue DESC
  `;
  const rows = await queryRows(ctx, sql, [tenantId]);
  return { period, paymentMethods: rows.map(r => ({ method: r.payment_method, transactionCount: safeNum(r.transaction_count), revenue: safeNum(r.revenue) })) };
}

async function getRevenueByBranch({ tenantId, period }) {
  const ctx = authCtx(tenantId);
  const sql = `
    SELECT
      COALESCE(state->>'branchId', 'main') AS branch_id,
      COALESCE(state->>'branchName', 'Main Branch') AS branch_name,
      COUNT(*)::int AS transaction_count,
      COALESCE(SUM((state->>'price')::numeric), 0) AS revenue
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    GROUP BY state->>'branchId', state->>'branchName'
    ORDER BY revenue DESC
  `;
  const rows = await queryRows(ctx, sql, [tenantId]);
  return { period, branches: rows.map(r => ({ branchId: r.branch_id, branchName: r.branch_name, transactionCount: safeNum(r.transaction_count), revenue: safeNum(r.revenue) })) };
}

// ── New: Branch Performance ──────────────────────────────────────────────

async function getBranchPerformance({ tenantId, period }) {
  const ctx = authCtx(tenantId);
  const revSql = `
    SELECT
      COALESCE(state->>'branchId', 'main') AS branch_id,
      COALESCE(state->>'branchName', 'Main Branch') AS branch_name,
      COUNT(DISTINCT state->>'customerId') AS customer_count,
      COUNT(*)::int AS transaction_count,
      COALESCE(SUM((state->>'price')::numeric), 0) AS revenue
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    GROUP BY state->>'branchId', state->>'branchName'
    ORDER BY revenue DESC
  `;
  const expSql = `
    SELECT
      COALESCE(state->>'branchId', 'main') AS branch_id,
      COALESCE(SUM((state->>'amount')::numeric), 0) AS expenses
    FROM app.runtime_state,
    jsonb_array_elements(state->'expenses') AS state
    WHERE state->>'tenantId' = $1
    GROUP BY state->>'branchId'
  `;

  const [revRows, expRows] = await Promise.all([
    queryRows(ctx, revSql, [tenantId]),
    queryRows(ctx, expSql, [tenantId]),
  ]);

  const expMap = {};
  for (const e of expRows) expMap[e.branch_id] = safeNum(e.expenses);

  const branches = revRows.map(r => {
    const branchExpenses = expMap[r.branch_id] || 0;
    const branchRevenue = safeNum(r.revenue);
    return {
      branchId: r.branch_id,
      branchName: r.branch_name,
      customerCount: safeNum(r.customer_count),
      transactionCount: safeNum(r.transaction_count),
      revenue: branchRevenue,
      expenses: branchExpenses,
      profit: branchRevenue - branchExpenses,
    };
  });

  return { period, branches };
}

// ── New: Service Revenue Breakdown ───────────────────────────────────────

async function getServiceRevenueBreakdown({ tenantId, period, groupBy }) {
  const ctx = authCtx(tenantId);
  const groupExpr = groupBy === 'staff' ? "state->>'staffName'" : groupBy === 'branch' ? "state->>'branchName'" : "state->>'serviceName'";
  const groupLabel = groupBy === 'staff' ? 'staff_name' : groupBy === 'branch' ? 'branch_name' : 'service_name';
  const groupId = groupBy === 'staff' ? "state->>'staffId'" : groupBy === 'branch' ? "state->>'branchId'" : "state->>'serviceName'";

  const sql = `
    SELECT ${groupExpr} AS ${groupLabel},
      COUNT(*)::int AS transaction_count,
      COALESCE(SUM((state->>'price')::numeric), 0) AS revenue,
      COALESCE(AVG((state->>'price')::numeric), 0) AS avg_value
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    GROUP BY ${groupExpr}
    ORDER BY revenue DESC
  `;
  const rows = await queryRows(ctx, sql, [tenantId]);
  return { period, groupBy: groupBy || 'service', items: rows };
}

// ── New: Profit Margin Breakdown ─────────────────────────────────────────

async function getProfitMarginBreakdown({ tenantId, period, groupBy }) {
  const ctx = authCtx(tenantId);
  const gb = groupBy || 'service';
  const result = { period, groupBy: gb, items: [] };

  if (gb === 'service') {
    const sql = `
      SELECT
        state->>'serviceName' AS name,
        COUNT(*)::int AS count,
        COALESCE(SUM((state->>'price')::numeric), 0) AS revenue,
        COALESCE(SUM((state->>'cost')::numeric), 0) AS cost
      FROM app.runtime_state,
      jsonb_array_elements(state->'serviceRecords') AS state
      WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
      GROUP BY state->>'serviceName'
      ORDER BY revenue DESC
    `;
    const rows = await queryRows(ctx, sql, [tenantId]);
    result.items = rows.map(r => {
      const rev = safeNum(r.revenue);
      const cost = safeNum(r.cost);
      const profit = rev - cost;
      return { name: r.name, count: safeNum(r.count), revenue: rev, cost, profit, margin: rev > 0 ? profit / rev : 0 };
    });
  } else if (gb === 'branch') {
    const revRows = await queryRows(ctx, `
      SELECT COALESCE(state->>'branchName', 'Main Branch') AS name, COALESCE(SUM((state->>'price')::numeric), 0) AS revenue
      FROM app.runtime_state, jsonb_array_elements(state->'serviceRecords') AS state
      WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
      GROUP BY state->>'branchName'
    `, [tenantId]);
    const expRows = await queryRows(ctx, `
      SELECT COALESCE(state->>'branchName', 'Main Branch') AS name, COALESCE(SUM((state->>'amount')::numeric), 0) AS cost
      FROM app.runtime_state, jsonb_array_elements(state->'expenses') AS state
      WHERE state->>'tenantId' = $1
      GROUP BY state->>'branchName'
    `, [tenantId]);
    const costMap = {};
    for (const e of expRows) costMap[e.name] = safeNum(e.cost);
    result.items = revRows.map(r => {
      const rev = safeNum(r.revenue);
      const cost = costMap[r.name] || 0;
      const profit = rev - cost;
      return { name: r.name, revenue: rev, cost, profit, margin: rev > 0 ? profit / rev : 0 };
    });
  }
  return result;
}

// ── New: Top Customers ───────────────────────────────────────────────────

async function getTopCustomers({ tenantId, period, limit }) {
  const ctx = authCtx(tenantId);
  const lim = limit || 10;
  const sql = `
    SELECT
      state->>'customerId' AS customer_id,
      COALESCE(state->>'customerName', state->>'customerId') AS customer_name,
      COUNT(*)::int AS visit_count,
      COALESCE(SUM((state->>'price')::numeric), 0) AS total_spent,
      MIN(state->>'performedAt') AS first_visit,
      MAX(state->>'performedAt') AS last_visit
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    GROUP BY state->>'customerId', state->>'customerName'
    ORDER BY total_spent DESC
    LIMIT $2
  `;
  const rows = await queryRows(ctx, sql, [tenantId, lim]);
  return { period, customers: rows.map(r => ({
    customerId: r.customer_id, name: r.customer_name, visitCount: safeNum(r.visit_count),
    totalSpent: safeNum(r.total_spent), firstVisit: r.first_visit, lastVisit: r.last_visit,
    avgSpend: safeNum(r.visit_count) > 0 ? safeNum(r.total_spent) / safeNum(r.visit_count) : 0,
  })) };
}

// ── New: Customer Activity ───────────────────────────────────────────────

async function getCustomerActivity({ tenantId, period, daysInactive }) {
  const ctx = authCtx(tenantId);
  const inactiveDays = daysInactive || 30;

  const allSql = `
    SELECT
      state->>'customerId' AS customer_id,
      COALESCE(state->>'customerName', state->>'customerId') AS customer_name,
      COUNT(*)::int AS visit_count,
      COALESCE(SUM((state->>'price')::numeric), 0) AS total_spent,
      MAX(state->>'performedAt') AS last_visit
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    GROUP BY state->>'customerId', state->>'customerName'
    ORDER BY last_visit DESC
  `;
  const rows = await queryRows(ctx, allSql, [tenantId]);
  const now = new Date();
  const active = [];
  const inactive = [];
  const newCust = [];

  for (const r of rows) {
    const lastVisit = new Date(r.last_visit);
    const daysSinceLastVisit = (now - lastVisit) / 86400000;
    const totalSpent = safeNum(r.total_spent);
    const visitCount = safeNum(r.visit_count);
    const entry = {
      customerId: r.customer_id, name: r.customer_name, visitCount, totalSpent,
      lastVisit: r.last_visit, daysSinceLastVisit: Math.round(daysSinceLastVisit),
      avgSpend: visitCount > 0 ? totalSpent / visitCount : 0,
    };
    if (daysSinceLastVisit <= inactiveDays) active.push(entry);
    else inactive.push(entry);
    if (visitCount === 1) newCust.push(entry);
  }

  return { period, activeCustomers: active, inactiveCustomers: inactive, newCustomers: newCust,
    totalCustomers: rows.length, activeCount: active.length, inactiveCount: inactive.length, newCount: newCust.length };
}

// ── New: Service Profitability ───────────────────────────────────────────

async function getServiceProfitability({ tenantId, period }) {
  return getProfitMarginBreakdown({ tenantId, period, groupBy: 'service' });
}

// ── New: Invoice Status ──────────────────────────────────────────────────

async function getInvoiceStatus({ tenantId, period, status }) {
  const ctx = authCtx(tenantId);
  let sql = `
    SELECT
      state->>'invoiceId' AS invoice_id,
      state->>'paymentStatus' AS payment_status,
      COALESCE(state->>'customerName', 'Unknown') AS customer_name,
      COALESCE((state->>'price')::numeric, 0) AS amount,
      state->>'performedAt' AS date
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
  `;
  const params = [tenantId];

  const pf = buildPeriodFilter(sql, params, period);
  sql = pf.sql;
  params.length = 0;
  params.push(tenantId);
  buildPeriodFilter(sql, params, period);

  if (status) {
    sql += ` AND state->>'paymentStatus' = $${params.length + 1}`;
    params.push(status);
  }

  const rows = await queryRows(ctx, sql, params);
  const paid = rows.filter(r => r.payment_status === 'paid' || r.payment_status === 'Paid' || r.payment_status === 'PAID');
  const unpaid = rows.filter(r => r.payment_status !== 'paid' && r.payment_status !== 'Paid' && r.payment_status !== 'PAID');
  const totalAmount = rows.reduce((s, r) => s + safeNum(r.amount), 0);

  return {
    period, total: rows.length, paidCount: paid.length, unpaidCount: unpaid.length,
    paidAmount: paid.reduce((s, r) => s + safeNum(r.amount), 0),
    unpaidAmount: unpaid.reduce((s, r) => s + safeNum(r.amount), 0),
    totalAmount, invoices: rows.slice(0, 50),
  };
}

// ── New: Revenue Forecast (simple trend-based) ────────────────────────────

async function getRevenueForecast({ tenantId, period }) {
  const ctx = authCtx(tenantId);
  const targetPeriods = { next_month: 30, next_quarter: 90, next_year: 365 };
  const days = targetPeriods[period] || 30;

  const historySql = `
    SELECT DATE(state->>'performedAt') AS day, COALESCE(SUM((state->>'price')::numeric), 0) AS daily_revenue
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
      AND state->>'performedAt' >= $2
    GROUP BY day
    ORDER BY day
  `;
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
  const history = await queryRows(ctx, historySql, [tenantId, ninetyDaysAgo]);

  if (history.length < 3) {
    return { period, forecast: null, message: 'Insufficient historical data (need at least 3 days of revenue data) to generate a forecast.', method: 'trend' };
  }

  const values = history.map(r => safeNum(r.daily_revenue));
  const avgDaily = values.reduce((s, v) => s + v, 0) / values.length;
  const recentAvg = values.slice(-14).reduce((s, v) => s + v, 0) / Math.min(14, values.length);
  const trend = recentAvg / (avgDaily || 1);
  const projectedDaily = avgDaily * trend;
  const projectedRevenue = projectedDaily * days;

  return {
    period, method: 'trend',
    historicalDailyAvg: Math.round(avgDaily * 100) / 100,
    recentDailyAvg: Math.round(recentAvg * 100) / 100,
    trendFactor: Math.round(trend * 100) / 100,
    projectedRevenue: Math.round(projectedRevenue * 100) / 100,
    projectedDays: days,
    dataPoints: history.length,
    confidence: values.length >= 30 ? 'HIGH' : values.length >= 14 ? 'MEDIUM' : 'LOW',
  };
}

async function getExpenseForecast({ tenantId, period }) {
  const ctx = authCtx(tenantId);
  const targetPeriods = { next_month: 30, next_quarter: 90, next_year: 365 };
  const days = targetPeriods[period] || 30;

  const sql = `
    SELECT DATE(state->>'expenseDate') AS day, COALESCE(SUM((state->>'amount')::numeric), 0) AS daily_expense
    FROM app.runtime_state,
    jsonb_array_elements(state->'expenses') AS state
    WHERE state->>'tenantId' = $1 AND state->>'expenseDate' >= $2
    GROUP BY day ORDER BY day
  `;
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
  const history = await queryRows(ctx, sql, [tenantId, ninetyDaysAgo]);

  if (history.length < 3) {
    return { period, forecast: null, message: 'Insufficient historical expense data for a forecast.', method: 'average' };
  }

  const values = history.map(r => safeNum(r.daily_expense));
  const avgDaily = values.reduce((s, v) => s + v, 0) / values.length;
  return {
    period, method: 'average', historicalDailyAvg: Math.round(avgDaily * 100) / 100,
    projectedExpenses: Math.round(avgDaily * days * 100) / 100, projectedDays: days,
    dataPoints: history.length, confidence: history.length >= 30 ? 'HIGH' : 'MEDIUM',
  };
}

async function getDemandForecast({ tenantId, period, serviceId }) {
  const ctx = authCtx(tenantId);
  const targetPeriods = { next_month: 30, next_quarter: 90, next_year: 365 };
  const days = targetPeriods[period] || 30;

  let sql = `
    SELECT state->>'serviceName' AS service_name, COUNT(*)::int AS count
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
      AND state->>'performedAt' >= $2
  `;
  const params = [tenantId, new Date(Date.now() - 90 * 86400000).toISOString()];
  if (serviceId) { sql += ` AND state->>'serviceName' = $3`; params.push(serviceId); }
  sql += ` GROUP BY state->>'serviceName' ORDER BY count DESC`;

  const history = await queryRows(ctx, sql, params);
  if (history.length === 0) {
    return { period, forecast: null, message: 'No service demand data available for forecast.' };
  }

  const total = history.reduce((s, r) => s + safeNum(r.count), 0);
  const dailyRate = total / 90;
  const services = history.map(r => ({
    serviceName: r.service_name, historicalCount: safeNum(r.count),
    projectedCount: Math.round(dailyRate * days * (safeNum(r.count) / total)),
  }));

  return { period, method: 'proportional', services, totalProjectedBookings: Math.round(dailyRate * days), confidence: 'MEDIUM' };
}

// ── New: Business Health Score ────────────────────────────────────────────

async function getBusinessHealthScore({ tenantId, period }) {
  const ctx = authCtx(tenantId);

  const [rev, exp, cust, prevRev] = await Promise.all([
    queryOne(ctx, `
      SELECT COALESCE(SUM((state->>'price')::numeric), 0) AS revenue,
             COALESCE(AVG((state->>'price')::numeric), 0) AS avg_ticket,
             COUNT(*)::int AS tx_count
      FROM app.runtime_state, jsonb_array_elements(state->'serviceRecords') AS state
      WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    `, [tenantId]),
    queryOne(ctx, `
      SELECT COALESCE(SUM((state->>'amount')::numeric), 0) AS expenses
      FROM app.runtime_state, jsonb_array_elements(state->'expenses') AS state
      WHERE state->>'tenantId' = $1
    `, [tenantId]),
    queryOne(ctx, `
      SELECT COUNT(DISTINCT state->>'customerId') AS customer_count,
             COUNT(*)::int AS total_visits
      FROM app.runtime_state, jsonb_array_elements(state->'serviceRecords') AS state
      WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    `, [tenantId]),
    queryOne(ctx, `
      SELECT COALESCE(SUM((state->>'price')::numeric), 0) AS prev_revenue
      FROM app.runtime_state, jsonb_array_elements(state->'serviceRecords') AS state
      WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
        AND state->>'performedAt' >= $2 AND state->>'performedAt' < $3
    `, [tenantId,
      new Date(Date.now() - 60 * 86400000).toISOString(),
      new Date(Date.now() - 30 * 86400000).toISOString()]),
  ]);

  const revenue = safeNum(rev?.revenue);
  const prevRevenue = safeNum(prevRev?.prev_revenue);
  const expenses = safeNum(exp?.expenses);
  const avgTicket = safeNum(rev?.avg_ticket);
  const txCount = safeNum(rev?.tx_count);
  const customerCount = safeNum(cust?.customer_count);
  const totalVisits = safeNum(cust?.total_visits);

  const scores = {};
  const reasons = [];

  // Revenue growth score (0-25)
  if (revenue === 0 && prevRevenue === 0) {
    scores.revenueGrowth = 0;
    reasons.push('No revenue data available.');
  } else if (prevRevenue === 0) {
    scores.revenueGrowth = 15;
    reasons.push('Revenue exists but no prior period for comparison.');
  } else {
    const growth = (revenue - prevRevenue) / prevRevenue;
    if (growth > 0.2) { scores.revenueGrowth = 25; reasons.push('Strong revenue growth.'); }
    else if (growth > 0.05) { scores.revenueGrowth = 20; reasons.push('Moderate revenue growth.'); }
    else if (growth > -0.05) { scores.revenueGrowth = 15; reasons.push('Stable revenue.'); }
    else if (growth > -0.2) { scores.revenueGrowth = 8; reasons.push('Revenue declining.'); }
    else { scores.revenueGrowth = 3; reasons.push('Significant revenue decline.'); }
  }

  // Profitability score (0-25)
  if (revenue === 0) {
    scores.profitability = 0;
    reasons.push('No revenue to assess profitability.');
  } else {
    const margin = (revenue - expenses) / revenue;
    if (margin > 0.3) { scores.profitability = 25; reasons.push('Healthy profit margins.'); }
    else if (margin > 0.15) { scores.profitability = 20; reasons.push('Good profit margins.'); }
    else if (margin > 0.05) { scores.profitability = 15; reasons.push('Adequate profit margins.'); }
    else if (margin > 0) { scores.profitability = 10; reasons.push('Thin profit margins.'); }
    else { scores.profitability = 3; reasons.push('Operating at a loss.'); }
  }

  // Customer retention score (0-25)
  if (customerCount === 0) {
    scores.customers = 0;
    reasons.push('No customer data.');
  } else {
    const avgVisits = totalVisits / customerCount;
    if (avgVisits > 5) { scores.customers = 25; reasons.push('High customer loyalty and repeat visits.'); }
    else if (avgVisits > 3) { scores.customers = 20; reasons.push('Good customer retention.'); }
    else if (avgVisits > 1.5) { scores.customers = 15; reasons.push('Moderate customer retention.'); }
    else if (avgVisits > 1) { scores.customers = 10; reasons.push('Most customers visit once.'); }
    else { scores.customers = 5; reasons.push('Low customer engagement.'); }
  }

  // Expense control score (0-25)
  if (expenses === 0) { scores.expenseControl = 25; reasons.push('No expenses recorded.'); }
  else if (revenue === 0) { scores.expenseControl = 5; reasons.push('Expenses with no revenue.'); }
  else {
    const ratio = expenses / revenue;
    if (ratio < 0.3) { scores.expenseControl = 25; reasons.push('Excellent expense control.'); }
    else if (ratio < 0.5) { scores.expenseControl = 20; reasons.push('Good expense control.'); }
    else if (ratio < 0.7) { scores.expenseControl = 15; reasons.push('Moderate expense control.'); }
    else if (ratio < 0.9) { scores.expenseControl = 8; reasons.push('Expenses are high relative to revenue.'); }
    else { scores.expenseControl = 3; reasons.push('Expenses nearly equal or exceed revenue.'); }
  }

  const totalScore = Math.round((scores.revenueGrowth + scores.profitability + scores.customers + scores.expenseControl));
  let rating = 'Critical';
  if (totalScore >= 80) rating = 'Excellent';
  else if (totalScore >= 60) rating = 'Good';
  else if (totalScore >= 40) rating = 'Fair';
  else if (totalScore >= 20) rating = 'Poor';

  return { period, score: totalScore, maxScore: 100, rating, scores, reasons, revenue, expenses, customerCount, avgTicket };
}

// ── New: Executive Summary ───────────────────────────────────────────────

async function getExecutiveSummary({ tenantId, period }) {
  const ctx = authCtx(tenantId);

  const [rev, exp, cust, svc, staffResult] = await Promise.all([
    queryOne(ctx, `SELECT COALESCE(SUM((state->>'price')::numeric), 0) AS revenue, COUNT(*)::int AS tx_count, COALESCE(AVG((state->>'price')::numeric), 0) AS avg_ticket FROM app.runtime_state, jsonb_array_elements(state->'serviceRecords') AS state WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL`, [tenantId]),
    queryOne(ctx, `SELECT COALESCE(SUM((state->>'amount')::numeric), 0) AS expenses, COUNT(*)::int AS exp_count FROM app.runtime_state, jsonb_array_elements(state->'expenses') AS state WHERE state->>'tenantId' = $1`, [tenantId]),
    queryOne(ctx, `SELECT COUNT(DISTINCT state->>'customerId') AS cust_count FROM app.runtime_state, jsonb_array_elements(state->'serviceRecords') AS state WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL`, [tenantId]),
    queryRows(ctx, `SELECT state->>'serviceName' AS name, COUNT(*)::int AS cnt FROM app.runtime_state, jsonb_array_elements(state->'serviceRecords') AS state WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL GROUP BY state->>'serviceName' ORDER BY cnt DESC LIMIT 5`, [tenantId]),
    queryRows(ctx, `SELECT state->>'staffName' AS name, COUNT(*)::int AS cnt, COALESCE(SUM((state->>'price')::numeric), 0) AS rev FROM app.runtime_state, jsonb_array_elements(state->'serviceRecords') AS state WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL GROUP BY state->>'staffName' ORDER BY rev DESC LIMIT 5`, [tenantId]),
  ]);

  const revenue = safeNum(rev?.revenue);
  const expenses = safeNum(exp?.expenses);
  const netProfit = revenue - expenses;
  const grossMargin = revenue > 0 ? (revenue - expenses) / revenue : 0;
  const customerCount = safeNum(cust?.cust_count);
  const txCount = safeNum(rev?.tx_count);
  const avgTicket = safeNum(rev?.avg_ticket);

  return {
    period, summary: {
      revenue: Math.round(revenue * 100) / 100,
      expenses: Math.round(expenses * 100) / 100,
      netProfit: Math.round(netProfit * 100) / 100,
      grossMargin: Math.round(grossMargin * 10000) / 10000,
      transactionCount: txCount,
      averageTicket: Math.round(avgTicket * 100) / 100,
      customerCount,
      topServices: svc.map(s => ({ name: s.name, count: safeNum(s.cnt) })),
      topStaff: staffResult.map(s => ({ name: s.name || 'Unknown', transactions: safeNum(s.cnt), revenue: safeNum(s.rev) })),
      healthStatus: netProfit > 0 ? 'Profitable' : netProfit === 0 ? 'Break-even' : 'Loss-making',
    },
    generatedAt: new Date().toISOString(),
  };
}

// ── New: Search Tool ─────────────────────────────────────────────────────

async function searchBusinessData({ tenantId, query, type }) {
  const ctx = authCtx(tenantId);
  const q = `%${(query || '').trim()}%`;
  const results = { query, type: type || 'all', customers: [], transactions: [], services: [], expenses: [] };

  if (!type || type === 'all' || type === 'customers') {
    const sql = `
      SELECT DISTINCT state->>'customerId' AS id, COALESCE(state->>'customerName', state->>'customerId') AS name,
        COUNT(*)::int AS visit_count, COALESCE(SUM((state->>'price')::numeric), 0) AS total_spent,
        MAX(state->>'performedAt') AS last_visit
      FROM app.runtime_state, jsonb_array_elements(state->'serviceRecords') AS state
      WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
        AND (COALESCE(state->>'customerName', '') ILIKE $2 OR state->>'customerId' ILIKE $2)
      GROUP BY state->>'customerId', state->>'customerName'
      ORDER BY total_spent DESC LIMIT 20
    `;
    results.customers = await queryRows(ctx, sql, [tenantId, q]);
  }

  if (!type || type === 'all' || type === 'transactions') {
    const sql = `
      SELECT state->>'id' AS id, state->>'serviceName' AS service, state->>'customerName' AS customer,
        (state->>'price')::numeric AS amount, state->>'performedAt' AS date,
        state->>'paymentMethod' AS payment_method
      FROM app.runtime_state, jsonb_array_elements(state->'serviceRecords') AS state
      WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
        AND (COALESCE(state->>'serviceName', '') ILIKE $2 OR COALESCE(state->>'customerName', '') ILIKE $2 OR COALESCE(state->>'staffName', '') ILIKE $2)
      ORDER BY state->>'performedAt' DESC LIMIT 20
    `;
    results.transactions = await queryRows(ctx, sql, [tenantId, q]);
  }

  if (!type || type === 'all' || type === 'services') {
    const sql = `
      SELECT state->>'serviceName' AS name, COUNT(*)::int AS count,
        COALESCE(SUM((state->>'price')::numeric), 0) AS revenue,
        COALESCE(AVG((state->>'price')::numeric), 0) AS avg_price
      FROM app.runtime_state, jsonb_array_elements(state->'serviceRecords') AS state
      WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
        AND state->>'serviceName' ILIKE $2
      GROUP BY state->>'serviceName'
      ORDER BY count DESC LIMIT 20
    `;
    results.services = await queryRows(ctx, sql, [tenantId, q]);
  }

  if (!type || type === 'all' || type === 'expenses') {
    const sql = `
      SELECT state->>'id' AS id, state->>'category' AS category, state->>'description' AS description,
        (state->>'amount')::numeric AS amount, state->>'expenseDate' AS date
      FROM app.runtime_state, jsonb_array_elements(state->'expenses') AS state
      WHERE state->>'tenantId' = $1
        AND (state->>'description' ILIKE $2 OR state->>'category' ILIKE $2)
      ORDER BY state->>'expenseDate' DESC LIMIT 20
    `;
    results.expenses = await queryRows(ctx, sql, [tenantId, q]);
  }

  return results;
}

// ── New: Dashboard Data (aggregated for frontend) ─────────────────────────

async function getDashboardData({ tenantId, period }) {
  const [
    revenueData, expenseData, profitData, customerData, healthData,
    riskData, oppData, forecastData, branchData,
  ] = await Promise.all([
    getRevenueSummary({ tenantId, period }),
    getExpenseAnalysis({ tenantId, period }),
    getProfitAnalysis({ tenantId, period }),
    getCustomerIntelligence({ tenantId, period }),
    getBusinessHealthScore({ tenantId, period }),
    getDetectedRisks({ tenantId, period }),
    getOpportunities({ tenantId, period }),
    getRevenueForecast({ tenantId, period: 'next_month' }),
    getBranchPerformance({ tenantId, period }),
  ]);

  return {
    period,
    revenue: revenueData,
    expenses: expenseData,
    profitability: profitData,
    customers: customerData,
    healthScore: healthData,
    risks: riskData,
    opportunities: oppData,
    forecast: forecastData,
    branches: branchData,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  getRevenueSummary,
  getRevenueTrends,
  getExpenseAnalysis,
  getUnusualExpenses,
  getProfitAnalysis,
  getCustomerIntelligence,
  getServiceIntelligence,
  getSalesSummary,
  getStaffPerformance,
  getDetectedRisks,
  getCashFlowAnalysis,
  getOpportunities,
  // New revenue methods
  getRevenueByEmployee,
  getRevenueByService,
  getRevenueByPaymentMethod,
  getRevenueByBranch,
  // New branch performance
  getBranchPerformance,
  // New breakdowns
  getServiceRevenueBreakdown,
  getProfitMarginBreakdown,
  // New customer methods
  getTopCustomers,
  getCustomerActivity,
  // New service methods
  getServiceProfitability,
  // New invoice methods
  getInvoiceStatus,
  // New forecast methods
  getRevenueForecast,
  getExpenseForecast,
  getDemandForecast,
  // New health methods
  getBusinessHealthScore,
  getExecutiveSummary,
  // New search
  searchBusinessData,
  // New dashboard
  getDashboardData,
};

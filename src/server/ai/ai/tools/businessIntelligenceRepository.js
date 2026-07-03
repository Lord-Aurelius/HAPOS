"use strict";

const { queryRows, queryOne } = require("../../../db/query");

function authCtx(tenantId) {
  return { tenantId, userId: "ai-tool", role: "shop_admin" };
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
  params.length = 0;
  params.push(tenantId);
  buildPeriodFilter(sql, params, period);

  const stats = await queryOne(ctx, sql, params) || {};

  let dailyBreakdown = [];
  if (groupBy === "day" || groupBy === "week" || groupBy === "month") {
    const groupExpr = groupBy === "day"
      ? "DATE(state->>'performedAt')"
      : groupBy === "week"
        ? "DATE_TRUNC('week', (state->>'performedAt')::timestamp)"
        : "DATE_TRUNC('month', (state->>'performedAt')::timestamp)";
    const breakSql = `
      SELECT ${groupExpr} AS period_label,
        COALESCE(SUM((state->>'price')::numeric), 0) AS revenue,
        COUNT(*)::int AS transactions
      FROM app.runtime_state,
      jsonb_array_elements(state->'serviceRecords') AS state
      WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
      GROUP BY period_label
      ORDER BY period_label
    `;
    dailyBreakdown = await queryRows(ctx, breakSql, [tenantId]);
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
  buildPeriodFilter(sql, [tenantId], period);

  const stats = await queryOne(ctx, sql, [tenantId]) || {};

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
};

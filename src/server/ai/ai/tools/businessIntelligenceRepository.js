"use strict";

const { queryRows, queryOne } = require("../../../db/query");

function authCtx(tenantId, userId, role) {
  return { tenantId, userId: userId || "ai-tool", role: role || "shop_admin" };
}

function safeNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function buildPeriodFilter(sql, params, period, dateField) {
  if (!period) return { sql, params };
  const p = period.toLowerCase().trim();
  const now = new Date();
  const df = dateField || "performedAt";

  const startEnd = dateRange(p, now);
  if (!startEnd) return { sql, params };
  const { start, end } = startEnd;

  sql += ` AND state->>'${df}' >= $${params.length + 1} AND state->>'${df}' < $${params.length + 2}`;
  params.push(start.toISOString(), end.toISOString());
  return { sql, params };
}

function dateRange(period, now) {
  if (period === "today") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return { start, end: new Date(start.getTime() + 86400000) };
  }
  if (period === "yesterday") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
    return { start, end: new Date(start.getTime() + 86400000) };
  }
  if (period === "this_week") {
    const day = now.getUTCDay();
    const diff = now.getUTCDate() - day + (day === 0 ? -6 : 1);
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), diff));
    return { start, end: new Date(start.getTime() + 7 * 86400000) };
  }
  if (period === "last_week") {
    const day = now.getUTCDay();
    const diff = now.getUTCDate() - day + (day === 0 ? -6 : 1);
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), diff - 7));
    return { start, end: new Date(start.getTime() + 7 * 86400000) };
  }
  if (period === "this_month") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { start, end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
  }
  if (period === "last_month") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return { start, end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) };
  }
  if (period === "this_quarter") {
    const q = Math.floor(now.getUTCMonth() / 3);
    const start = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1));
    return { start, end: new Date(Date.UTC(now.getUTCFullYear(), q * 3 + 3, 1)) };
  }
  if (period === "last_quarter") {
    const q = Math.floor(now.getUTCMonth() / 3);
    const start = new Date(Date.UTC(now.getUTCFullYear(), q * 3 - 3, 1));
    return { start, end: new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1)) };
  }
  if (period === "this_year" || period === "ytd" || period === "year to date") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return { start, end: new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1)) };
  }
  if (period === "last_year") {
    const start = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
    return { start, end: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)) };
  }
  return null;
}

function previousPeriod(period) {
  if (period === "this_month") return "last_month";
  if (period === "this_week") return "last_week";
  if (period === "this_quarter") return "last_quarter";
  if (period === "this_year" || period === "ytd" || period === "year to date") return "last_year";
  if (period === "today") return "yesterday";
  return null;
}

function periodLabel(period) {
  if (!period) return "all time";
  const labels = {
    today: "Today", yesterday: "Yesterday", this_week: "This Week", last_week: "Last Week",
    this_month: "This Month", last_month: "Last Month", this_quarter: "This Quarter",
    last_quarter: "Last Quarter", this_year: "This Year", last_year: "Last Year", ytd: "Year to Date",
  };
  return labels[period.toLowerCase().trim()] || period;
}

async function queryServiceRecords(tenantId, period, extraSelect, extraJoin, extraWhere, extraGroup) {
  const ctx = authCtx(tenantId);
  let sql = `
    SELECT
      COALESCE(SUM((state->>'price')::numeric), 0) AS total_revenue,
      COUNT(*)::int AS transaction_count,
      COALESCE(AVG((state->>'price')::numeric), 0) AS avg_ticket
      ${extraSelect || ""}
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    ${extraWhere || ""}
  `;
  const params = [tenantId];
  const pf = buildPeriodFilter(sql, params, period);
  sql = pf.sql;
  sql += ` ${extraGroup || ""}`;
  const rows = await queryRows(ctx, sql, pf.params);
  return rows;
}

async function queryFirstServiceRecord(tenantId, period) {
  const ctx = authCtx(tenantId);
  let sql = `
    SELECT state->>'performedAt' AS first_date
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    ORDER BY state->>'performedAt' ASC LIMIT 1
  `;
  const params = [tenantId];
  const pf = buildPeriodFilter(sql, params, period);
  sql = pf.sql.replace(/ AND .*performedAt.*>=\s*\$(\d+).*performedAt.*<\s*\$(\d+)/, "");
  const row = await queryOne(ctx, sql, pf.params);
  return row ? row.first_date : null;
}

async function queryServiceCount(tenantId, period) {
  const ctx = authCtx(tenantId);
  let sql = `
    SELECT COUNT(*)::int AS total
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
  `;
  const params = [tenantId];
  const pf = buildPeriodFilter(sql, params, period);
  const row = await queryOne(ctx, sql, pf.params);
  return row ? safeNum(row.total) : 0;
}

function compareRanked(rows, key, labelKey, labelDefault) {
  if (!rows || rows.length === 0) {
    return { top: null, second: null, difference: 0, percentageDifference: 0, ranking: [] };
  }
  const items = rows.map((r, i) => ({
    name: r[labelKey] || labelDefault || "Unknown",
    value: safeNum(r[key]),
    rank: i + 1,
  }));
  const top = items[0] || null;
  const second = items[1] || null;
  const difference = top && second ? top.value - second.value : 0;
  const percentageDifference = top && second && second.value > 0 ? ((top.value - second.value) / second.value) * 100 : 0;
  return { top, second, difference, percentageDifference, ranking: items };
}

async function getRevenueSummary({ tenantId, period, groupBy }) {
  const ctx = authCtx(tenantId);
  const gb = groupBy || "total";

  if (gb === "total" || gb === "overall") {
    const rows = await queryServiceRecords(tenantId, period);
    const row = rows[0] || {};
    return {
      period, groupBy: gb,
      total: safeNum(row.total_revenue),
      transactionCount: safeNum(row.transaction_count),
      averageTicket: safeNum(row.avg_ticket),
    };
  }

  if (["day", "week", "month", "quarter", "year"].includes(gb)) {
    const groupExprs = {
      day: "DATE(state->>'performedAt')",
      week: "DATE_TRUNC('week', (state->>'performedAt')::timestamp)",
      month: "DATE_TRUNC('month', (state->>'performedAt')::timestamp)",
      quarter: "DATE_TRUNC('quarter', (state->>'performedAt')::timestamp)",
      year: "DATE_TRUNC('year', (state->>'performedAt')::timestamp)",
    };
    const groupExpr = groupExprs[gb];
    let sql = `
      SELECT ${groupExpr} AS period_label,
        COALESCE(SUM((state->>'price')::numeric), 0) AS revenue,
        COUNT(*)::int AS transactions,
        COALESCE(AVG((state->>'price')::numeric), 0) AS avg_ticket
      FROM app.runtime_state,
      jsonb_array_elements(state->'serviceRecords') AS state
      WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    `;
    const params = [tenantId];
    const pf = buildPeriodFilter(sql, params, period);
    sql = pf.sql;
    sql += ` GROUP BY period_label ORDER BY period_label`;
    const rows = await queryRows(ctx, sql, pf.params);
    const total = rows.reduce((s, r) => s + safeNum(r.revenue), 0);
    return { period, groupBy: gb, total, breakdown: rows };
  }

  const groupMap = {
    service: { field: "serviceName", label: "service_name", id: "serviceName" },
    employee: { field: "staffId", label: "employee_name", nameSrc: "staffName", id: "staffId" },
    branch: { field: "branchId", label: "branch_name", nameSrc: "branchName", id: "branchId" },
    customer: { field: "customerId", label: "customer_name", nameSrc: "customerName", id: "customerId" },
    payment_method: { field: "paymentMethod", label: "payment_method", id: "paymentMethod" },
    staff: { field: "staffId", label: "staff_name", nameSrc: "staffName", id: "staffId" },
  };

  const g = groupMap[gb] || groupMap.service;
  const nameExpr = g.nameSrc
    ? `COALESCE(state->>'${g.nameSrc}', state->>'${g.id}', 'Unknown')`
    : `COALESCE(state->>'${g.field}', 'Unknown')`;

  let sql = `
    SELECT ${nameExpr} AS ${g.label},
      COALESCE(SUM((state->>'price')::numeric), 0) AS revenue,
      COUNT(*)::int AS transactions,
      COALESCE(AVG((state->>'price')::numeric), 0) AS avg_ticket
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
  `;
  const params = [tenantId];
  const pf = buildPeriodFilter(sql, params, period);
  sql = pf.sql;
  sql += ` GROUP BY ${nameExpr} ORDER BY revenue DESC`;
  const rows = await queryRows(ctx, sql, pf.params);
  const total = rows.reduce((s, r) => s + safeNum(r.revenue), 0);
  const items = rows.map(r => {
    const rev = safeNum(r.revenue);
    return {
      name: r[g.label] || "Unknown",
      revenue: rev,
      transactions: safeNum(r.transactions),
      avgTicket: safeNum(r.avg_ticket),
      percentage: total > 0 ? Math.round((rev / total) * 1000) / 10 : 0,
    };
  });
  const ranked = compareRanked(rows, "revenue", g.label, "Unknown");
  return { period, groupBy: gb, total, items, ...ranked };
}

async function getRevenueTrends({ tenantId, period, comparison }) {
  const ctx = authCtx(tenantId);

  if (comparison === "period_over_period" || comparison === "pop") {
    const prev = previousPeriod(period);
    const currentRows = await queryServiceRecords(tenantId, period);
    const prevRows = prev ? await queryServiceRecords(tenantId, prev) : [];
    const curr = currentRows[0] || {};
    const prv = prevRows[0] || {};
    const currentRevenue = safeNum(curr.total_revenue);
    const previousRevenue = safeNum(prv.total_revenue);
    const changePct = previousRevenue > 0 ? ((currentRevenue - previousRevenue) / previousRevenue) * 100 : null;
    return {
      period, comparison: "period_over_period",
      currentPeriod: periodLabel(period),
      previousPeriod: periodLabel(prev),
      currentRevenue, previousRevenue,
      changePercent: changePct != null ? Math.round(changePct * 100) / 100 : null,
      direction: changePct > 0 ? "up" : changePct < 0 ? "down" : "flat",
      currentTransactions: safeNum(curr.transaction_count),
      previousTransactions: safeNum(prv.transaction_count),
    };
  }

  const now = new Date();
  const currentStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const currentEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevEnd = currentStart;

  const sql = `
    WITH current AS (
      SELECT COALESCE(SUM((state->>'price')::numeric), 0) AS revenue,
        COUNT(*)::int AS transactions
      FROM app.runtime_state,
      jsonb_array_elements(state->'serviceRecords') AS state
      WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
        AND state->>'performedAt' >= $2 AND state->>'performedAt' < $3
    ),
    previous AS (
      SELECT COALESCE(SUM((state->>'price')::numeric), 0) AS revenue,
        COUNT(*)::int AS transactions
      FROM app.runtime_state,
      jsonb_array_elements(state->'serviceRecords') AS state
      WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
        AND state->>'performedAt' >= $4 AND state->>'performedAt' < $5
    )
    SELECT
      current.revenue AS current_revenue, current.transactions AS current_transactions,
      previous.revenue AS previous_revenue, previous.transactions AS previous_transactions,
      CASE WHEN previous.revenue > 0 THEN ((current.revenue - previous.revenue) / previous.revenue) * 100 ELSE NULL END AS change_pct
    FROM current, previous
  `;
  const result = await queryOne(ctx, sql, [
    tenantId, currentStart.toISOString(), currentEnd.toISOString(),
    prevStart.toISOString(), prevEnd.toISOString(),
  ]) || {};

  return {
    period,
    currentRevenue: safeNum(result.current_revenue),
    previousRevenue: safeNum(result.previous_revenue),
    currentTransactions: safeNum(result.current_transactions),
    previousTransactions: safeNum(result.previous_transactions),
    changePercent: result.change_pct != null ? Math.round(safeNum(result.change_pct) * 100) / 100 : null,
    direction: result.change_pct > 0 ? "up" : result.change_pct < 0 ? "down" : "flat",
  };
}

async function getRevenueByService({ tenantId, period }) {
  return getRevenueSummary({ tenantId, period, groupBy: "service" });
}

async function getRevenueByEmployee({ tenantId, period }) {
  return getRevenueSummary({ tenantId, period, groupBy: "employee" });
}

async function getRevenueByPaymentMethod({ tenantId, period }) {
  return getRevenueSummary({ tenantId, period, groupBy: "payment_method" });
}

async function getRevenueByBranch({ tenantId, period }) {
  return getRevenueSummary({ tenantId, period, groupBy: "branch" });
}

async function getServiceRevenueBreakdown({ tenantId, period, groupBy }) {
  const gb = groupBy || "service";
  if (gb === "staff") return getRevenueByEmployee({ tenantId, period });
  if (gb === "branch") return getRevenueByBranch({ tenantId, period });
  return getRevenueByService({ tenantId, period });
}

async function getServiceIntelligence({ tenantId, period }) {
  const ctx = authCtx(tenantId);
  let sql = `
    SELECT
      COALESCE(state->>'serviceName', 'Unknown') AS name,
      COUNT(*)::int AS count,
      COALESCE(SUM((state->>'price')::numeric), 0) AS revenue,
      COALESCE(AVG((state->>'price')::numeric), 0) AS avg_price,
      COALESCE(SUM((state->>'cost')::numeric), 0) AS total_cost
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
  `;
  const params = [tenantId];
  const pf = buildPeriodFilter(sql, params, period);
  sql = pf.sql;
  sql += ` GROUP BY state->>'serviceName' ORDER BY revenue DESC`;
  const rows = await queryRows(ctx, sql, pf.params);

  if (rows.length === 0) {
    return { period, services: [], totalRevenue: 0, topService: null, message: "No service transactions recorded for this period." };
  }

  const services = rows.map(r => {
    const rev = safeNum(r.revenue);
    const cost = safeNum(r.total_cost);
    const profit = rev - cost;
    return {
      name: r.name,
      count: safeNum(r.count),
      revenue: rev,
      avgPrice: safeNum(r.avg_price),
      totalCost: cost,
      profit,
      margin: rev > 0 ? profit / rev : 0,
    };
  });
  const totalRevenue = services.reduce((s, sv) => s + sv.revenue, 0);
  const totalCount = services.reduce((s, sv) => s + sv.count, 0);

  const ranked = [...services].sort((a, b) => b.revenue - a.revenue);
  const topService = ranked[0] || null;
  const lowestService = ranked[ranked.length - 1] || null;
  const mostFrequent = [...services].sort((a, b) => b.count - a.count)[0] || null;
  const leastFrequent = [...services].sort((a, b) => a.count - b.count)[0] || null;
  const highestMargin = [...services].sort((a, b) => b.margin - a.margin)[0] || null;
  const lowestMargin = [...services].sort((a, b) => a.margin - b.margin)[0] || null;
  const topVsSecond = ranked.length > 1 ? {
    topName: ranked[0].name, topRevenue: ranked[0].revenue,
    secondName: ranked[1].name, secondRevenue: ranked[1].revenue,
    difference: ranked[0].revenue - ranked[1].revenue,
    percentageDifference: ranked[1].revenue > 0 ? ((ranked[0].revenue - ranked[1].revenue) / ranked[1].revenue) * 100 : null,
  } : null;

  const repeatSql = `
    SELECT state->>'customerId' AS customer_id, COUNT(*)::int AS visits
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    GROUP BY state->>'customerId'
  `;
  const customerVisits = await queryRows(ctx, repeatSql, [tenantId]);
  const repeatCount = customerVisits.filter(r => safeNum(r.visits) > 1).length;
  const repeatRate = customerVisits.length > 0 ? repeatCount / customerVisits.length : 0;

  services.forEach(s => {
    s.percentage = totalRevenue > 0 ? Math.round((s.revenue / totalRevenue) * 1000) / 10 : 0;
  });

  return {
    period,
    services,
    totalRevenue,
    totalTransactions: totalCount,
    topService: topService ? { name: topService.name, revenue: topService.revenue, count: topService.count, percentage: totalRevenue > 0 ? Math.round((topService.revenue / totalRevenue) * 1000) / 10 : 0 } : null,
    lowestService: lowestService ? { name: lowestService.name, revenue: lowestService.revenue, count: lowestService.count } : null,
    mostFrequentService: mostFrequent ? { name: mostFrequent.name, count: mostFrequent.count } : null,
    leastFrequentService: leastFrequent ? { name: leastFrequent.name, count: leastFrequent.count } : null,
    highestMarginService: highestMargin ? { name: highestMargin.name, margin: Math.round(highestMargin.margin * 10000) / 10000 } : null,
    lowestMarginService: lowestMargin ? { name: lowestMargin.name, margin: Math.round(lowestMargin.margin * 10000) / 10000 } : null,
    topVsSecond,
    repeatRate: Math.round(repeatRate * 10000) / 10000,
    ranking: ranked.map((s, i) => ({ rank: i + 1, name: s.name, revenue: s.revenue, count: s.count })),
  };
}

async function getServiceProfitability({ tenantId, period }) {
  return getProfitMarginBreakdown({ tenantId, period, groupBy: "service" });
}

async function getSalesSummary({ tenantId, period }) {
  const ctx = authCtx(tenantId);
  let sql = `
    SELECT
      COUNT(*)::int AS total_transactions,
      COALESCE(SUM((state->>'price')::numeric), 0) AS total_revenue,
      COALESCE(AVG((state->>'price')::numeric), 0) AS average_ticket,
      COALESCE(MIN((state->>'price')::numeric), 0) AS min_ticket,
      COALESCE(MAX((state->>'price')::numeric), 0) AS max_ticket
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
  `;
  const params = [tenantId];
  const pf = buildPeriodFilter(sql, params, period);
  const stats = await queryOne(ctx, sql, pf.params) || {};

  const pmSql = `
    SELECT COALESCE(state->>'paymentMethod', 'Unknown') AS payment_method,
      COUNT(*)::int AS count,
      COALESCE(SUM((state->>'price')::numeric), 0) AS total
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    GROUP BY state->>'paymentMethod'
    ORDER BY total DESC
  `;
  const pmRows = await queryRows(ctx, pmSql, [tenantId]);
  const total = stats.total_revenue ? safeNum(stats.total_revenue) : 0;
  const paymentMethods = pmRows.map(r => ({
    method: r.payment_method,
    count: safeNum(r.count),
    total: safeNum(r.total),
    percentage: total > 0 ? Math.round((safeNum(r.total) / total) * 10000) / 100 : 0,
  }));

  const busySql = `
    SELECT DATE(state->>'performedAt') AS day,
      COUNT(*)::int AS transactions,
      COALESCE(SUM((state->>'price')::numeric), 0) AS revenue
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    GROUP BY day ORDER BY transactions DESC LIMIT 1
  `;
  const busiestDay = await queryOne(ctx, busySql, [tenantId]);

  return {
    period,
    totalTransactions: safeNum(stats.total_transactions),
    totalRevenue: total,
    averageTicket: safeNum(stats.average_ticket),
    minTicket: safeNum(stats.min_ticket),
    maxTicket: safeNum(stats.max_ticket),
    paymentMethods,
    busiestDay: busiestDay ? { date: busiestDay.day, transactions: safeNum(busiestDay.transactions), revenue: safeNum(busiestDay.revenue) } : null,
  };
}

async function getStaffPerformance({ tenantId, period }) {
  const ctx = authCtx(tenantId);
  let sql = `
    SELECT
      state->>'staffId' AS staff_id,
      COALESCE(state->>'staffName', state->>'staffId', 'Unknown') AS staff_name,
      COUNT(*)::int AS services_rendered,
      COALESCE(SUM((state->>'price')::numeric), 0) AS revenue_generated,
      COALESCE(AVG((state->>'price')::numeric), 0) AS avg_ticket,
      COALESCE(SUM((state->>'commissionAmount')::numeric), 0) AS total_commission
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
  `;
  const params = [tenantId];
  const pf = buildPeriodFilter(sql, params, period);
  sql = pf.sql;
  sql += ` GROUP BY state->>'staffId', state->>'staffName' ORDER BY revenue_generated DESC`;
  const rows = await queryRows(ctx, sql, pf.params);

  const voidSql = `
    SELECT state->>'staffId' AS staff_id,
      COUNT(*)::int AS voided_count
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NOT NULL
    GROUP BY state->>'staffId'
  `;
  const voidRows = await queryRows(ctx, voidSql, [tenantId]);
  const voidMap = {};
  for (const v of voidRows) voidMap[v.staff_id] = safeNum(v.voided_count);

  if (rows.length === 0) {
    return { period, staff: [], message: "No staff performance data for this period." };
  }

  const totalRevenue = rows.reduce((s, r) => s + safeNum(r.revenue_generated), 0);
  const staff = rows.map(r => {
    const rev = safeNum(r.revenue_generated);
    const tx = safeNum(r.services_rendered);
    const voided = voidMap[r.staff_id] || 0;
    return {
      staffId: r.staff_id,
      name: r.staff_name || "Unknown",
      servicesRendered: tx,
      revenueGenerated: rev,
      avgTicket: safeNum(r.avg_ticket),
      totalCommission: safeNum(r.total_commission),
      voidedCount: voided,
      refundRate: tx > 0 ? voided / tx : 0,
      percentage: totalRevenue > 0 ? Math.round((rev / totalRevenue) * 1000) / 10 : 0,
    };
  });

  const ranked = compareRanked(rows, "revenue_generated", "staff_name", "Unknown");
  const bestPerformer = staff[0] || null;
  const lowestPerformer = staff[staff.length - 1] || null;
  const bestVsSecond = staff.length > 1 ? {
    topName: staff[0].name, topRevenue: staff[0].revenueGenerated,
    secondName: staff[1].name, secondRevenue: staff[1].revenueGenerated,
    difference: staff[0].revenueGenerated - staff[1].revenueGenerated,
  } : null;

  return {
    period,
    staff,
    totalRevenue,
    bestPerformer: bestPerformer ? { name: bestPerformer.name, revenue: bestPerformer.revenueGenerated, transactions: bestPerformer.servicesRendered } : null,
    lowestPerformer: lowestPerformer ? { name: lowestPerformer.name, revenue: lowestPerformer.revenueGenerated, transactions: lowestPerformer.servicesRendered } : null,
    bestVsSecond,
    ...ranked,
  };
}

async function getCustomerIntelligence({ tenantId, period }) {
  const ctx = authCtx(tenantId);
  const prevPeriod = previousPeriod(period);

  let sql = `
    SELECT
      state->>'customerId' AS customer_id,
      COALESCE(state->>'customerName', state->>'customerId', 'Unknown') AS customer_name,
      COUNT(*)::int AS visit_count,
      COALESCE(SUM((state->>'price')::numeric), 0) AS total_spent,
      MIN(state->>'performedAt') AS first_visit,
      MAX(state->>'performedAt') AS last_visit
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
  `;
  const params = [tenantId];
  const pf = buildPeriodFilter(sql, params, period);
  sql = pf.sql;
  sql += ` GROUP BY state->>'customerId', state->>'customerName' ORDER BY total_spent DESC`;
  const rows = await queryRows(ctx, sql, pf.params);

  if (rows.length === 0) {
    return { period, totalCustomers: 0, message: "No customer data for this period." };
  }

  const now = new Date();
  const totalRevenue = rows.reduce((s, r) => s + safeNum(r.total_spent), 0);

  const customers = rows.map(r => {
    const spent = safeNum(r.total_spent);
    const visits = safeNum(r.visit_count);
    const lastVisit = r.last_visit ? new Date(r.last_visit) : null;
    const daysSinceLastVisit = lastVisit ? Math.round((now - lastVisit) / 86400000) : null;
    return {
      customerId: r.customer_id,
      name: r.customer_name || "Unknown",
      visitCount: visits,
      totalSpent: spent,
      avgSpend: visits > 0 ? spent / visits : 0,
      firstVisit: r.first_visit,
      lastVisit: r.last_visit,
      daysSinceLastVisit,
      lifetimeValue: spent,
    };
  });

  const activeThreshold = 30;
  const activeCustomers = customers.filter(c => c.daysSinceLastVisit !== null && c.daysSinceLastVisit <= activeThreshold);
  const inactiveCustomers = customers.filter(c => c.daysSinceLastVisit !== null && c.daysSinceLastVisit > activeThreshold);
  const churnedCustomers = customers.filter(c => c.daysSinceLastVisit !== null && c.daysSinceLastVisit > 90);
  const newCustomers = customers.filter(c => c.visitCount === 1);
  const returningCustomers = customers.filter(c => c.visitCount > 1);
  const loyalCustomers = customers.filter(c => c.visitCount >= 5);

  const topBySpend = customers.slice(0, 10).map((c, i) => ({ rank: i + 1, ...c }));
  const topByVisits = [...customers].sort((a, b) => b.visitCount - a.visitCount).slice(0, 10).map((c, i) => ({ rank: i + 1, ...c }));

  let prevCustomerCount = 0;
  if (prevPeriod) {
    let prevSql = `
      SELECT COUNT(DISTINCT state->>'customerId') AS cnt
      FROM app.runtime_state,
      jsonb_array_elements(state->'serviceRecords') AS state
      WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    `;
    const prevParams = [tenantId];
    const pf2 = buildPeriodFilter(prevSql, prevParams, prevPeriod);
    const prevRow = await queryOne(ctx, prevSql, pf2.params);
    prevCustomerCount = safeNum(prevRow?.cnt);
  }

  return {
    period,
    totalCustomers: customers.length,
    activeCustomers: activeCustomers.length,
    inactiveCustomers: inactiveCustomers.length,
    churnedCustomers: churnedCustomers.length,
    newCustomers: newCustomers.length,
    returningCustomers: returningCustomers.length,
    loyalCustomers: loyalCustomers.length,
    repeatRate: customers.length > 0 ? returningCustomers.length / customers.length : 0,
    totalCustomerRevenue: totalRevenue,
    averageRevenuePerCustomer: customers.length > 0 ? totalRevenue / customers.length : 0,
    customerGrowth: prevCustomerCount > 0 ? customers.length - prevCustomerCount : null,
    topCustomersBySpend: topBySpend,
    topCustomersByVisits: topByVisits,
    activeCustomers: customers.filter(c => c.daysSinceLastVisit !== null && c.daysSinceLastVisit <= activeThreshold),
  };
}

async function getTopCustomers({ tenantId, period, limit }) {
  const lim = limit || 10;
  const data = await getCustomerIntelligence({ tenantId, period });
  return {
    period,
    customers: data.topCustomersBySpend ? data.topCustomersBySpend.slice(0, lim) : [],
    totalCustomers: data.totalCustomers || 0,
    totalRevenue: data.totalCustomerRevenue || 0,
  };
}

async function getCustomerActivity({ tenantId, period, daysInactive }) {
  const inactiveDays = daysInactive || 30;
  const data = await getCustomerIntelligence({ tenantId, period });
  const active = data.activeCustomers || [];
  const all = data.topCustomersBySpend || [];
  const inactiveCusts = all.filter(c => c.daysSinceLastVisit !== null && c.daysSinceLastVisit > inactiveDays);
  return {
    period,
    activeCustomers: active,
    inactiveCustomers: inactiveCusts,
    newCustomers: data.totalCustomers > 0 && data.newCustomers ? all.filter(c => c.visitCount === 1) : [],
    totalCustomers: data.totalCustomers || 0,
    activeCount: active.length,
    inactiveCount: inactiveCusts.length,
    newCount: data.totalCustomers > 0 && data.newCustomers ? all.filter(c => c.visitCount === 1).length : 0,
  };
}

async function getExpenseAnalysis({ tenantId, period, category }) {
  const ctx = authCtx(tenantId);

  let sql = `
    SELECT
      COALESCE(SUM((state->>'amount')::numeric), 0) AS total_expenses,
      COUNT(*)::int AS expense_count,
      COALESCE(AVG((state->>'amount')::numeric), 0) AS avg_expense,
      COALESCE(MAX((state->>'amount')::numeric), 0) AS max_expense,
      COALESCE(MIN((state->>'amount')::numeric), 0) AS min_expense
    FROM app.runtime_state,
    jsonb_array_elements(state->'expenses') AS state
    WHERE state->>'tenantId' = $1
  `;
  const params = [tenantId];
  const pf = buildExpensePeriodFilter(sql, params, period);
  sql = pf.sql;
  if (category) {
    sql += ` AND state->>'category' = $${pf.params.length + 1}`;
    pf.params.push(category);
  }
  const stats = await queryOne(ctx, sql, pf.params) || {};

  const catSql = `
    SELECT state->>'category' AS category,
      COALESCE(SUM((state->>'amount')::numeric), 0) AS total,
      COUNT(*)::int AS count,
      COALESCE(AVG((state->>'amount')::numeric), 0) AS avg_amount
    FROM app.runtime_state,
    jsonb_array_elements(state->'expenses') AS state
    WHERE state->>'tenantId' = $1
  `;
  const catParams = [tenantId];
  const cpf = buildExpensePeriodFilter(catSql, catParams, period);
  const byCategory = await queryRows(ctx, cpf.sql, cpf.params);

  const monthSql = `
    SELECT DATE_TRUNC('month', (state->>'expenseDate')::timestamp) AS month,
      COALESCE(SUM((state->>'amount')::numeric), 0) AS total,
      COUNT(*)::int AS count
    FROM app.runtime_state,
    jsonb_array_elements(state->'expenses') AS state
    WHERE state->>'tenantId' = $1
  `;
  const mParams = [tenantId];
  const mpf = buildExpensePeriodFilter(monthSql, mParams, period);
  const monthly = await queryRows(ctx, mpf.sql, mpf.params);

  const largestSql = `
    SELECT state->>'id' AS id, state->>'category' AS category,
      state->>'description' AS description,
      (state->>'amount')::numeric AS amount,
      state->>'expenseDate' AS expense_date
    FROM app.runtime_state,
    jsonb_array_elements(state->'expenses') AS state
    WHERE state->>'tenantId' = $1
  `;
  const lParams = [tenantId];
  const lpf = buildExpensePeriodFilter(largestSql, lParams, period);
  const largest = await queryRows(ctx, lpf.sql, lpf.params);
  largest.sort((a, b) => safeNum(b.amount) - safeNum(a.amount));
  const topExpenses = largest.slice(0, 10).map(r => ({
    id: r.id, description: r.description || r.category, category: r.category,
    amount: safeNum(r.amount), date: r.expense_date,
  }));

  const total = safeNum(stats.total_expenses);
  const prevPeriod = period === "this_month" ? "last_month" : null;
  let trend = null;
  if (prevPeriod) {
    const prevData = await getExpenseAnalysis({ tenantId, period: prevPeriod });
    const prevTotal = safeNum(prevData.total);
    if (prevTotal > 0) {
      const change = ((total - prevTotal) / prevTotal) * 100;
      trend = {
        direction: change > 0 ? "up" : change < 0 ? "down" : "flat",
        changePercent: Math.round(change * 100) / 100,
        previousTotal: prevTotal,
      };
    }
  }

  return {
    period,
    total,
    count: safeNum(stats.expense_count),
    avgExpense: safeNum(stats.avg_expense),
    maxExpense: safeNum(stats.max_expense),
    minExpense: safeNum(stats.min_expense),
    byCategory: byCategory.map(r => ({
      category: r.category || "Uncategorised",
      total: safeNum(r.total),
      count: safeNum(r.count),
      avgAmount: safeNum(r.avg_amount),
    })),
    monthlyTrend: monthly.map(r => ({
      month: r.month,
      total: safeNum(r.total),
      count: safeNum(r.count),
    })),
    largestExpenses: topExpenses,
    trend,
  };
}

function buildExpensePeriodFilter(sql, params, period) {
  if (!period) return { sql: sql, params };
  const result = buildPeriodFilter(
    sql.replace(/performedAt/g, "expenseDate"),
    params,
    period,
    "expenseDate"
  );
  return result;
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
  return { unusualExpenses: rows.map(r => ({
    id: r.id, category: r.category, description: r.description || r.category,
    amount: safeNum(r.amount), date: r.expense_date, createdBy: r.created_by,
  })) };
}

async function getProfitAnalysis({ tenantId, period }) {
  const ctx = authCtx(tenantId);

  const revSql = `
    SELECT COALESCE(SUM((state->>'price')::numeric), 0) AS revenue,
      COUNT(*)::int AS transactions
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
  `;
  const expSql = `
    SELECT COALESCE(SUM((state->>'amount')::numeric), 0) AS expenses,
      COUNT(*)::int AS expense_count
    FROM app.runtime_state,
    jsonb_array_elements(state->'expenses') AS state
    WHERE state->>'tenantId' = $1
  `;

  const doQuery = async (baseSql) => {
    const params = [tenantId];
    const pf = buildPeriodFilter(baseSql, params, period);
    return await queryOne(ctx, pf.sql, pf.params) || {};
  };

  const revenue = await doQuery(revSql);
  const revenueCtx = authCtx(tenantId);
  let revParams = [tenantId];
  const revPf = buildPeriodFilter(revSql, revParams, period);
  const revRow = await queryOne(revenueCtx, revPf.sql, revPf.params) || {};

  let expParams = [tenantId];
  const expPf = buildExpensePeriodFilter(expSql, expParams, period);
  const expRow = await queryOne(ctx, expPf.sql, expPf.params) || {};

  const totalRevenue = safeNum(revRow.revenue);
  const totalExpenses = safeNum(expRow.expenses);
  const grossProfit = totalRevenue;
  const netProfit = totalRevenue - totalExpenses;
  const grossMargin = totalRevenue > 0 ? 1 : 0;
  const netMargin = totalRevenue > 0 ? netProfit / totalRevenue : 0;
  const costToRevenueRatio = totalRevenue > 0 ? totalExpenses / totalRevenue : 0;

  const prevPeriod = period === "this_month" ? "last_month" : previousPeriod(period);
  let trend = null;
  if (prevPeriod) {
    let prevRevParams = [tenantId];
    const prevRevPf = buildPeriodFilter(revSql, prevRevParams, prevPeriod);
    const prevRev = await queryOne(ctx, revPf.sql, prevRevParams) || {};
    let prevExpParams = [tenantId];
    const prevExpPf = buildExpensePeriodFilter(expSql, prevExpParams, prevPeriod);
    const prevExp = await queryOne(ctx, prevExpPf.sql, prevExpParams) || {};
    const prevNet = safeNum(prevRev.revenue) - safeNum(prevExp.expenses);
    if (prevNet !== 0) {
      trend = {
        direction: netProfit > prevNet ? "up" : netProfit < prevNet ? "down" : "flat",
        changePercent: Math.round(((netProfit - prevNet) / Math.abs(prevNet)) * 10000) / 100,
        previousNetProfit: Math.round(prevNet * 100) / 100,
      };
    }
  }

  return {
    period,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    grossProfit: Math.round(grossProfit * 100) / 100,
    netProfit: Math.round(netProfit * 100) / 100,
    grossMargin: Math.round(grossMargin * 10000) / 10000,
    netMargin: Math.round(netMargin * 10000) / 10000,
    costToRevenueRatio: Math.round(costToRevenueRatio * 10000) / 10000,
    transactionCount: safeNum(revRow.transactions),
    expenseCount: safeNum(expRow.expense_count),
    trend,
  };
}

async function getProfitMarginBreakdown({ tenantId, period, groupBy }) {
  const gb = groupBy || "service";
  const result = { period, groupBy: gb, items: [] };

  if (gb === "service") {
    const ctx = authCtx(tenantId);
    let sql = `
      SELECT
        state->>'serviceName' AS name,
        COUNT(*)::int AS count,
        COALESCE(SUM((state->>'price')::numeric), 0) AS revenue,
        COALESCE(SUM((state->>'cost')::numeric), 0) AS cost
      FROM app.runtime_state,
      jsonb_array_elements(state->'serviceRecords') AS state
      WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
    `;
    const params = [tenantId];
    const pf = buildPeriodFilter(sql, params, period);
    sql = pf.sql;
    sql += ` GROUP BY state->>'serviceName' ORDER BY revenue DESC`;
    const rows = await queryRows(ctx, sql, pf.params);
    const totalRev = rows.reduce((s, r) => s + safeNum(r.revenue), 0);
    result.items = rows.map(r => {
      const rev = safeNum(r.revenue);
      const cost = safeNum(r.cost);
      const profit = rev - cost;
      return {
        name: r.name,
        count: safeNum(r.count),
        revenue: rev,
        cost,
        profit,
        margin: rev > 0 ? Math.round((profit / rev) * 10000) / 10000 : 0,
        percentage: totalRev > 0 ? Math.round((rev / totalRev) * 1000) / 10 : 0,
      };
    });
    result.totalRevenue = totalRev;
  } else if (gb === "branch") {
    const revData = await getRevenueByBranch({ tenantId, period });
    const expData = await getExpenseAnalysis({ tenantId, period });
    const expMap = {};
    for (const cat of expData.byCategory || []) {
      expMap[cat.category] = safeNum(cat.total);
    }
    result.items = (revData.items || []).map(sr => {
      const rev = safeNum(sr.revenue);
      const cost = Object.values(expMap).reduce((s, v) => s + v, 0) / Math.max(1, revData.items.length);
      const profit = rev - cost;
      return {
        name: sr.name,
        revenue: rev,
        cost: Math.round(cost * 100) / 100,
        profit: Math.round(profit * 100) / 100,
        margin: rev > 0 ? Math.round((profit / rev) * 10000) / 10000 : 0,
      };
    });
  }
  return result;
}

async function getBranchPerformance({ tenantId, period }) {
  const ctx = authCtx(tenantId);

  let revSql = `
    SELECT
      COALESCE(state->>'branchId', 'main') AS branch_id,
      COALESCE(state->>'branchName', 'Main Branch') AS branch_name,
      COUNT(DISTINCT state->>'customerId') AS customer_count,
      COUNT(*)::int AS transaction_count,
      COALESCE(SUM((state->>'price')::numeric), 0) AS revenue
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
  `;
  let revParams = [tenantId];
  const revPf = buildPeriodFilter(revSql, revParams, period);
  revSql = revPf.sql;
  revSql += ` GROUP BY state->>'branchId', state->>'branchName' ORDER BY revenue DESC`;
  const revRows = await queryRows(ctx, revSql, revPf.params);

  let expSql = `
    SELECT
      COALESCE(state->>'branchId', 'main') AS branch_id,
      COALESCE(SUM((state->>'amount')::numeric), 0) AS expenses
    FROM app.runtime_state,
    jsonb_array_elements(state->'expenses') AS state
    WHERE state->>'tenantId' = $1
  `;
  let expParams = [tenantId];
  const expPf = buildExpensePeriodFilter(expSql, expParams, period);
  expSql = expPf.sql;
  expSql += ` GROUP BY state->>'branchId'`;
  const expRows = await queryRows(ctx, expSql, expPf.params);
  const expMap = {};
  for (const e of expRows) expMap[e.branch_id] = safeNum(e.expenses);

  if (revRows.length === 0) {
    return { period, branches: [], message: "No branch data for this period." };
  }

  const branches = revRows.map(r => {
    const branchExpenses = expMap[r.branch_id] || 0;
    const branchRevenue = safeNum(r.revenue);
    const profit = branchRevenue - branchExpenses;
    return {
      branchId: r.branch_id,
      branchName: r.branch_name,
      customerCount: safeNum(r.customer_count),
      transactionCount: safeNum(r.transaction_count),
      revenue: branchRevenue,
      expenses: branchExpenses,
      profit,
      margin: branchRevenue > 0 ? profit / branchRevenue : 0,
    };
  });

  const ranked = [...branches].sort((a, b) => b.revenue - a.revenue);
  const topBranch = ranked[0] || null;
  const mostProfitable = [...branches].sort((a, b) => b.profit - a.profit)[0] || null;
  const topVsSecond = ranked.length > 1 ? {
    topName: ranked[0].branchName, topRevenue: ranked[0].revenue,
    secondName: ranked[1].branchName, secondRevenue: ranked[1].revenue,
    difference: ranked[0].revenue - ranked[1].revenue,
  } : null;

  const prevPeriod = previousPeriod(period);
  let prevRevData = null;
  if (prevPeriod) {
    prevRevData = await getBranchPerformance({ tenantId, period: prevPeriod });
  }

  branches.forEach((b, i) => {
    b.rank = i + 1;
    if (prevRevData && prevRevData.branches) {
      const prev = prevRevData.branches.find(p => p.branchId === b.branchId);
      if (prev && prev.revenue > 0) {
        b.growth = Math.round(((b.revenue - prev.revenue) / prev.revenue) * 10000) / 100;
      } else {
        b.growth = null;
      }
    }
  });

  return {
    period,
    branches,
    topBranch: topBranch ? { name: topBranch.branchName, revenue: topBranch.revenue, profit: topBranch.profit } : null,
    mostProfitableBranch: mostProfitable ? { name: mostProfitable.branchName, profit: mostProfitable.profit, margin: Math.round(mostProfitable.margin * 10000) / 10000 } : null,
    topVsSecond,
    ranking: branches.map(b => ({ rank: b.rank, name: b.branchName, revenue: b.revenue, profit: b.profit, growth: b.growth })),
  };
}

async function getProfitByBranch({ tenantId, period }) {
  const data = await getBranchPerformance({ tenantId, period });
  return {
    period,
    branches: data.branches.map(b => ({
      name: b.branchName,
      revenue: b.revenue,
      expenses: b.expenses,
      profit: b.profit,
      margin: b.margin,
    })),
  };
}

async function getDetectedRisks({ tenantId, period }) {
  const ctx = authCtx(tenantId);
  const risks = [];

  const countTx = await queryServiceCount(tenantId, period);
  if (countTx === 0) {
    risks.push({
      type: "no_transactions", severity: "critical",
      message: `No service transactions recorded for ${periodLabel(period)}. The business may not be operational.`,
      action: "Verify services are being recorded and staff are entering sales correctly.",
      priority: "critical",
    });
    return { risks };
  }

  const profitData = await getProfitAnalysis({ tenantId, period });
  if (profitData.netProfit < 0) {
    risks.push({
      type: "negative_profit", severity: "critical",
      message: `Business is operating at a loss of KES ${Math.abs(profitData.netProfit).toLocaleString()} for ${periodLabel(period)}.`,
      action: "Review expense categories and pricing strategy to restore profitability.",
      priority: "critical",
    });
  }

  if (profitData.costToRevenueRatio > 0.8 && profitData.totalRevenue > 0) {
    risks.push({
      type: "high_expense_ratio", severity: "warning",
      message: `Expenses (KES ${profitData.totalExpenses.toLocaleString()}) consume ${Math.round(profitData.costToRevenueRatio * 100)}% of revenue for ${periodLabel(period)}.`,
      action: "Identify and reduce unnecessary expenses to protect profitability.",
      priority: "high",
    });
  }

  const revTrends = await getRevenueTrends({ tenantId, period, comparison: "period_over_period" });
  if (revTrends.changePercent !== null && revTrends.changePercent < -20) {
    risks.push({
      type: "revenue_decline", severity: "warning",
      message: `Revenue declined ${Math.abs(revTrends.changePercent).toFixed(1)}% compared to ${revTrends.previousPeriod}.`,
      action: "Investigate causes of revenue decline and adjust strategy accordingly.",
      priority: "high",
    });
  }

  const custData = await getCustomerIntelligence({ tenantId, period });
  if (custData.totalCustomers > 0 && custData.churnedCustomers && custData.churnedCustomers > custData.totalCustomers * 0.5) {
    risks.push({
      type: "high_churn", severity: "warning",
      message: `${custData.churnedCustomers} of ${custData.totalCustomers} customers (${Math.round((custData.churnedCustomers / custData.totalCustomers) * 100)}%) have not visited in over 90 days.`,
      action: "Implement customer retention campaigns and loyalty programs.",
      priority: "medium",
    });
  }

  if (risks.length === 0) {
    risks.push({
      type: "no_risks_detected", severity: "info",
      message: `No significant risks detected for ${periodLabel(period)}. The business appears to be in a healthy state.`,
      action: "Continue monitoring key metrics regularly.",
      priority: "low",
    });
  }

  return { risks };
}

async function getCashFlowAnalysis({ tenantId, period }) {
  const revData = await getRevenueSummary({ tenantId, period });
  const expData = await getExpenseAnalysis({ tenantId, period });
  const totalInflow = revData.total || 0;
  const totalOutflow = expData.total || 0;
  return {
    period,
    totalInflow,
    totalOutflow,
    netCashFlow: totalInflow - totalOutflow,
    transactionCount: revData.transactionCount || 0,
    expenseCount: expData.count || 0,
    inflowAvgTicket: revData.averageTicket || 0,
    outflowAvgExpense: expData.avgExpense || 0,
  };
}

async function getOpportunities({ tenantId, period }) {
  const opportunities = [];
  const svcData = await getServiceIntelligence({ tenantId, period });

  if (svcData.services && svcData.services.length > 0) {
    const top = svcData.topService;
    if (top) {
      opportunities.push({
        type: "top_service_promotion", severity: "info",
        message: `"${top.name}" is the top service generating KES ${top.revenue.toLocaleString()} (${top.percentage}% of total revenue).`,
        action: `Feature "${top.name}" in marketing and train staff to upsell it.`,
        priority: "medium",
      });
    }

    const low = svcData.lowestService;
    if (low && low.revenue > 0 && svcData.services.length > 1) {
      opportunities.push({
        type: "underperforming_service", severity: "info",
        message: `"${low.name}" generated only KES ${low.revenue.toLocaleString()}. Review its pricing or viability.`,
        action: `Evaluate if "${low.name}" needs repositioning, a price change, or discontinuation.`,
        priority: "low",
      });
    }
  }

  const custData = await getCustomerIntelligence({ tenantId, period });
  if (custData.totalCustomers > 0) {
    if (custData.returningCustomers < custData.totalCustomers * 0.3) {
      opportunities.push({
        type: "repeat_customer_conversion", severity: "info",
        message: `Only ${custData.returningCustomers} of ${custData.totalCustomers} customers (${Math.round((custData.returningCustomers / custData.totalCustomers) * 100)}%) are repeat visitors.`,
        action: "Launch a loyalty program and follow-up campaigns to convert one-time visitors into regular customers.",
        priority: "medium",
      });
    }

    if (custData.loyalCustomers && custData.loyalCustomers > 0) {
      opportunities.push({
        type: "loyalty_program", severity: "info",
        message: `${custData.loyalCustomers} customers have visited 5+ times. These loyal customers are ideal for a VIP programme.`,
        action: "Create a VIP tier with exclusive benefits to reward and retain your most loyal customers.",
        priority: "medium",
      });
    }
  }

  const revTrends = await getRevenueTrends({ tenantId, period, comparison: "period_over_period" });
  if (revTrends.changePercent !== null && revTrends.changePercent > 20) {
    opportunities.push({
      type: "strong_growth", severity: "info",
      message: `Revenue grew ${revTrends.changePercent.toFixed(1)}% compared to ${revTrends.previousPeriod}. The business is on a strong upward trajectory.`,
      action: "Analyse the factors driving growth and replicate them across the business.",
      priority: "low",
    });
  }

  const profData = await getProfitAnalysis({ tenantId, period });
  if (profData.netMargin > 0.3) {
    opportunities.push({
      type: "high_profit_margin", severity: "info",
      message: `Net profit margin is ${(profData.netMargin * 100).toFixed(1)}%, indicating strong profitability.`,
      action: "Consider reinvesting profits into expansion, marketing, or new service offerings.",
      priority: "low",
    });
  }

  if (opportunities.length === 0) {
    opportunities.push({
      type: "no_opportunities", severity: "info",
      message: `No specific growth opportunities identified for ${periodLabel(period)}. Continue monitoring business metrics.`,
      action: "Regularly review sales data and customer feedback to identify emerging opportunities.",
      priority: "low",
    });
  }

  return { opportunities };
}

async function getBusinessHealthScore({ tenantId, period }) {
  const ctx = authCtx(tenantId);

  let revSql = `
    SELECT COALESCE(SUM((state->>'price')::numeric), 0) AS revenue,
           COALESCE(AVG((state->>'price')::numeric), 0) AS avg_ticket,
           COUNT(*)::int AS tx_count
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
  `;
  let prevRevSql = `
    SELECT COALESCE(SUM((state->>'price')::numeric), 0) AS prev_revenue
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
      AND state->>'performedAt' >= $2 AND state->>'performedAt' < $3
  `;

  let expSql = `
    SELECT COALESCE(SUM((state->>'amount')::numeric), 0) AS expenses
    FROM app.runtime_state,
    jsonb_array_elements(state->'expenses') AS state
    WHERE state->>'tenantId' = $1
  `;
  let custSql = `
    SELECT COUNT(DISTINCT state->>'customerId') AS customer_count,
           COUNT(*)::int AS total_visits
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
  `;

  const now = new Date();
  const rev = await queryOne(ctx, revSql, [tenantId]) || {};
  const prevRev = await queryOne(ctx, prevRevSql, [
    tenantId,
    new Date(now.getTime() - 60 * 86400000).toISOString(),
    new Date(now.getTime() - 30 * 86400000).toISOString(),
  ]) || {};
  const expenses = await queryOne(ctx, expSql, [tenantId]) || {};
  const customers = await queryOne(ctx, custSql, [tenantId]) || {};

  const revenue = safeNum(rev.revenue);
  const prevRevenue = safeNum(prevRev.prev_revenue);
  const totalExpenses = safeNum(expenses.expenses);
  const avgTicket = safeNum(rev.avg_ticket);
  const txCount = safeNum(rev.tx_count);
  const customerCount = safeNum(customers.customer_count);
  const totalVisits = safeNum(customers.total_visits);

  const scores = {};
  const reasons = [];

  if (revenue === 0 && prevRevenue === 0) {
    scores.revenueGrowth = 0;
    reasons.push("No revenue data available.");
  } else if (prevRevenue === 0) {
    scores.revenueGrowth = 15;
    reasons.push("Revenue exists but no prior period for comparison.");
  } else {
    const growth = (revenue - prevRevenue) / prevRevenue;
    if (growth > 0.2) { scores.revenueGrowth = 25; reasons.push("Strong revenue growth."); }
    else if (growth > 0.05) { scores.revenueGrowth = 20; reasons.push("Moderate revenue growth."); }
    else if (growth > -0.05) { scores.revenueGrowth = 15; reasons.push("Stable revenue."); }
    else if (growth > -0.2) { scores.revenueGrowth = 8; reasons.push("Revenue declining."); }
    else { scores.revenueGrowth = 3; reasons.push("Significant revenue decline."); }
  }

  if (revenue === 0) {
    scores.profitability = 0;
    reasons.push("No revenue to assess profitability.");
  } else {
    const margin = (revenue - totalExpenses) / revenue;
    if (margin > 0.3) { scores.profitability = 25; reasons.push("Healthy profit margins."); }
    else if (margin > 0.15) { scores.profitability = 20; reasons.push("Good profit margins."); }
    else if (margin > 0.05) { scores.profitability = 15; reasons.push("Adequate profit margins."); }
    else if (margin > 0) { scores.profitability = 10; reasons.push("Thin profit margins."); }
    else { scores.profitability = 3; reasons.push("Operating at a loss."); }
  }

  if (customerCount === 0) {
    scores.customers = 0;
    reasons.push("No customer data.");
  } else {
    const avgVisits = totalVisits / customerCount;
    if (avgVisits > 5) { scores.customers = 25; reasons.push("High customer loyalty and repeat visits."); }
    else if (avgVisits > 3) { scores.customers = 20; reasons.push("Good customer retention."); }
    else if (avgVisits > 1.5) { scores.customers = 15; reasons.push("Moderate customer retention."); }
    else if (avgVisits > 1) { scores.customers = 10; reasons.push("Most customers visit once."); }
    else { scores.customers = 5; reasons.push("Low customer engagement."); }
  }

  if (totalExpenses === 0) { scores.expenseControl = 25; reasons.push("No expenses recorded."); }
  else if (revenue === 0) { scores.expenseControl = 5; reasons.push("Expenses with no revenue."); }
  else {
    const ratio = totalExpenses / revenue;
    if (ratio < 0.3) { scores.expenseControl = 25; reasons.push("Excellent expense control."); }
    else if (ratio < 0.5) { scores.expenseControl = 20; reasons.push("Good expense control."); }
    else if (ratio < 0.7) { scores.expenseControl = 15; reasons.push("Moderate expense control."); }
    else if (ratio < 0.9) { scores.expenseControl = 8; reasons.push("Expenses are high relative to revenue."); }
    else { scores.expenseControl = 3; reasons.push("Expenses nearly equal or exceed revenue."); }
  }

  const totalScore = Math.round(scores.revenueGrowth + scores.profitability + scores.customers + scores.expenseControl);
  let rating = "Critical";
  if (totalScore >= 80) rating = "Excellent";
  else if (totalScore >= 60) rating = "Good";
  else if (totalScore >= 40) rating = "Fair";
  else if (totalScore >= 20) rating = "Poor";

  return {
    period, score: totalScore, maxScore: 100, rating, scores, reasons,
    revenue, expenses: totalExpenses, customerCount, avgTicket,
  };
}

async function getExecutiveSummary({ tenantId, period }) {
  const [
    rev, exp, cust, svc, staffData,
  ] = await Promise.all([
    getRevenueSummary({ tenantId, period }),
    getExpenseAnalysis({ tenantId, period }),
    getCustomerIntelligence({ tenantId, period }),
    getServiceIntelligence({ tenantId, period }),
    getStaffPerformance({ tenantId, period }),
  ]);

  const revenue = rev.total || 0;
  const expenses = exp.total || 0;
  const netProfit = revenue - expenses;
  const grossMargin = revenue > 0 ? (revenue - expenses) / revenue : 0;
  const customerCount = cust.totalCustomers || 0;
  const txCount = rev.transactionCount || 0;
  const avgTicket = rev.averageTicket || 0;

  return {
    period,
    summary: {
      revenue: Math.round(revenue * 100) / 100,
      expenses: Math.round(expenses * 100) / 100,
      netProfit: Math.round(netProfit * 100) / 100,
      grossMargin: Math.round(grossMargin * 10000) / 10000,
      transactionCount: txCount,
      averageTicket: Math.round(avgTicket * 100) / 100,
      customerCount,
      topServices: (svc.services || []).slice(0, 5).map(s => ({ name: s.name, count: s.count, revenue: s.revenue })),
      topStaff: (staffData.staff || []).slice(0, 5).map(s => ({
        name: s.name, transactions: s.servicesRendered, revenue: s.revenueGenerated,
      })),
      topCustomers: (cust.topCustomersBySpend || []).slice(0, 5).map(c => ({
        name: c.name, totalSpent: c.totalSpent, visits: c.visitCount,
      })),
      healthStatus: netProfit > 0 ? "Profitable" : netProfit === 0 ? "Break-even" : "Loss-making",
    },
    generatedAt: new Date().toISOString(),
  };
}

async function searchBusinessData({ tenantId, query, type }) {
  const ctx = authCtx(tenantId);
  const q = `%${(query || "").trim()}%`;
  const results = { query, type: type || "all", customers: [], transactions: [], services: [], expenses: [] };

  if (!type || type === "all" || type === "customers") {
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

  if (!type || type === "all" || type === "transactions") {
    const sql = `
      SELECT state->>'id' AS id, state->>'serviceName' AS service,
        COALESCE(state->>'customerName', state->>'customerId') AS customer,
        (state->>'price')::numeric AS amount, state->>'performedAt' AS date,
        COALESCE(state->>'paymentMethod', 'Unknown') AS payment_method
      FROM app.runtime_state, jsonb_array_elements(state->'serviceRecords') AS state
      WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
        AND (COALESCE(state->>'serviceName', '') ILIKE $2
          OR COALESCE(state->>'customerName', '') ILIKE $2
          OR COALESCE(state->>'staffName', '') ILIKE $2)
      ORDER BY state->>'performedAt' DESC LIMIT 20
    `;
    results.transactions = await queryRows(ctx, sql, [tenantId, q]);
  }

  if (!type || type === "all" || type === "services") {
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

  if (!type || type === "all" || type === "expenses") {
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

async function getInvoiceStatus({ tenantId, period, status }) {
  const ctx = authCtx(tenantId);
  let sql = `
    SELECT
      state->>'invoiceId' AS invoice_id,
      COALESCE(state->>'paymentStatus', 'unpaid') AS payment_status,
      COALESCE(state->>'customerName', state->>'customerId', 'Unknown') AS customer_name,
      COALESCE((state->>'price')::numeric, 0) AS amount,
      state->>'performedAt' AS date
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
  `;
  const params = [tenantId];
  const pf = buildPeriodFilter(sql, params, period);
  sql = pf.sql;
  if (status) {
    sql += ` AND LOWER(state->>'paymentStatus') = LOWER($${params.length + 1})`;
    params.push(status);
  }
  const rows = await queryRows(ctx, sql, pf.params);
  const paid = rows.filter(r => {
    const ps = (r.payment_status || "").toLowerCase();
    return ps === "paid" || ps === "completed";
  });
  const unpaid = rows.filter(r => {
    const ps = (r.payment_status || "").toLowerCase();
    return ps !== "paid" && ps !== "completed";
  });
  const totalAmount = rows.reduce((s, r) => s + safeNum(r.amount), 0);

  return {
    period, total: rows.length, paidCount: paid.length, unpaidCount: unpaid.length,
    paidAmount: paid.reduce((s, r) => s + safeNum(r.amount), 0),
    unpaidAmount: unpaid.reduce((s, r) => s + safeNum(r.amount), 0),
    totalAmount, invoices: rows.slice(0, 50),
  };
}

async function getRevenueForecast({ tenantId, period }) {
  const ctx = authCtx(tenantId);
  const targetPeriods = { next_month: 30, next_quarter: 90, next_year: 365 };
  const days = targetPeriods[period] || 30;

  const historySql = `
    SELECT DATE(state->>'performedAt') AS day,
      COALESCE(SUM((state->>'price')::numeric), 0) AS daily_revenue,
      COUNT(*)::int AS daily_transactions
    FROM app.runtime_state,
    jsonb_array_elements(state->'serviceRecords') AS state
    WHERE state->>'tenantId' = $1 AND state->>'voidedAt' IS NULL
      AND state->>'performedAt' >= $2
    GROUP BY day ORDER BY day
  `;
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
  const history = await queryRows(ctx, historySql, [tenantId, ninetyDaysAgo]);

  if (history.length < 3) {
    return {
      period, forecast: null,
      message: "Insufficient historical data (need at least 3 days of revenue data) to generate a forecast.",
      method: "trend",
    };
  }

  const values = history.map(r => safeNum(r.daily_revenue));
  const txValues = history.map(r => safeNum(r.daily_transactions));
  const avgDaily = values.reduce((s, v) => s + v, 0) / values.length;
  const avgDailyTx = txValues.reduce((s, v) => s + v, 0) / txValues.length;
  const recentAvg = values.slice(-14).reduce((s, v) => s + v, 0) / Math.min(14, values.length);
  const trend = recentAvg / (avgDaily || 1);
  const projectedDaily = avgDaily * trend;
  const projectedRevenue = projectedDaily * days;
  const projectedTransactions = Math.round(avgDailyTx * trend * days);

  return {
    period, method: "trend",
    historicalDailyAvg: Math.round(avgDaily * 100) / 100,
    recentDailyAvg: Math.round(recentAvg * 100) / 100,
    trendFactor: Math.round(trend * 100) / 100,
    projectedRevenue: Math.round(projectedRevenue * 100) / 100,
    projectedTransactions,
    projectedDays: days,
    dataPoints: history.length,
    confidence: values.length >= 30 ? "HIGH" : values.length >= 14 ? "MEDIUM" : "LOW",
  };
}

async function getExpenseForecast({ tenantId, period }) {
  const ctx = authCtx(tenantId);
  const targetPeriods = { next_month: 30, next_quarter: 90, next_year: 365 };
  const days = targetPeriods[period] || 30;

  const sql = `
    SELECT DATE(state->>'expenseDate') AS day,
      COALESCE(SUM((state->>'amount')::numeric), 0) AS daily_expense,
      COUNT(*)::int AS daily_count
    FROM app.runtime_state,
    jsonb_array_elements(state->'expenses') AS state
    WHERE state->>'tenantId' = $1 AND state->>'expenseDate' >= $2
    GROUP BY day ORDER BY day
  `;
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
  const history = await queryRows(ctx, sql, [tenantId, ninetyDaysAgo]);

  if (history.length < 3) {
    return { period, forecast: null, message: "Insufficient historical expense data for a forecast.", method: "average" };
  }

  const values = history.map(r => safeNum(r.daily_expense));
  const avgDaily = values.reduce((s, v) => s + v, 0) / values.length;
  return {
    period, method: "average", historicalDailyAvg: Math.round(avgDaily * 100) / 100,
    projectedExpenses: Math.round(avgDaily * days * 100) / 100, projectedDays: days,
    dataPoints: history.length, confidence: history.length >= 30 ? "HIGH" : "MEDIUM",
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
    return { period, forecast: null, message: "No service demand data available for forecast." };
  }

  const total = history.reduce((s, r) => s + safeNum(r.count), 0);
  const dailyRate = total / 90;
  const services = history.map(r => ({
    serviceName: r.service_name, historicalCount: safeNum(r.count),
    projectedCount: Math.round(dailyRate * days * (safeNum(r.count) / total)),
  }));

  return {
    period, method: "proportional", services,
    totalProjectedBookings: Math.round(dailyRate * days),
    confidence: "MEDIUM",
  };
}

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
    getRevenueForecast({ tenantId, period: "next_month" }),
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
  getRevenueByEmployee,
  getRevenueByService,
  getRevenueByPaymentMethod,
  getRevenueByBranch,
  getBranchPerformance,
  getServiceRevenueBreakdown,
  getProfitMarginBreakdown,
  getTopCustomers,
  getCustomerActivity,
  getServiceProfitability,
  getInvoiceStatus,
  getRevenueForecast,
  getExpenseForecast,
  getDemandForecast,
  getBusinessHealthScore,
  getExecutiveSummary,
  searchBusinessData,
  getDashboardData,
  getProfitByBranch,
};

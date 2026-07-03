"use strict";

const LOW_REVENUE_DAILY_THRESHOLD = 1000;
const HIGH_EXPENSE_RATIO_THRESHOLD = 0.8;
const LOW_PROFIT_MARGIN_THRESHOLD = 0.1;
const LOW_CUSTOMER_ACTIVITY_THRESHOLD = 5;

function safeNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function generateInsights(evidence) {
  const observations = [];
  const recommendations = [];

  const rev = evidence.revenue || {};
  const exp = evidence.expenses || {};
  const prof = evidence.profit || {};
  const cust = evidence.customers || {};
  const svc = evidence.services || [];
  const sales = evidence.sales || {};

  const period = evidence.period || "the current period";

  // Revenue insights
  const totalRevenue = safeNum(rev.total);
  if (totalRevenue > 0) {
    observations.push({
      type: "revenue_total",
      severity: "info",
      message: `Total revenue for ${period} is ${formatCurrency(totalRevenue)}.`,
    });
    if (totalRevenue < LOW_REVENUE_DAILY_THRESHOLD) {
      observations.push({
        type: "low_revenue",
        severity: "warning",
        message: `Revenue for ${period} is relatively low at ${formatCurrency(totalRevenue)}.`,
      });
      recommendations.push({
        type: "boost_revenue",
        priority: "high",
        message: `Consider promotions or upselling to increase revenue. Current: ${formatCurrency(totalRevenue)}.`,
      });
    }
  }

  const revChange = safeNum(rev.change);
  if (revChange !== 0) {
    const direction = revChange > 0 ? "increased" : "decreased";
    observations.push({
      type: "revenue_trend",
      severity: revChange > 0 ? "info" : "warning",
      message: `Revenue has ${direction} by ${Math.abs(revChange)}% compared to the previous period.`,
    });
    if (revChange < -10) {
      recommendations.push({
        type: "investigate_revenue_decline",
        priority: "high",
        message: `Revenue declined by ${Math.abs(revChange)}%. Investigate causes and consider corrective actions.`,
      });
    }
  }

  // Expense insights
  const totalExpenses = safeNum(exp.total);
  if (totalExpenses > 0) {
    observations.push({
      type: "expense_total",
      severity: "info",
      message: `Total expenses for ${period} are ${formatCurrency(totalExpenses)}.`,
    });
    if (totalRevenue > 0 && (totalExpenses / totalRevenue) > HIGH_EXPENSE_RATIO_THRESHOLD) {
      observations.push({
        type: "high_expense_ratio",
        severity: "warning",
        message: `Expenses consume ${Math.round((totalExpenses / totalRevenue) * 100)}% of revenue, which is above the recommended threshold.`,
      });
      recommendations.push({
        type: "reduce_expenses",
        priority: "high",
        message: "Review and reduce operating expenses to improve profitability.",
      });
    }
  }

  const unusual = evidence.unusualExpenses || [];
  if (unusual.length > 0) {
    observations.push({
      type: "unusual_expenses",
      severity: "warning",
      message: `Detected ${unusual.length} unusual expense(s) that deviate from normal patterns.`,
    });
    recommendations.push({
      type: "review_unusual_expenses",
      priority: "high",
      message: `Review ${unusual.length} unusual expense transaction(s) for legitimacy.`,
    });
  }

  // Profitability insights
  const grossProfit = safeNum(prof.grossProfit);
  const netProfit = safeNum(prof.netProfit);
  const grossMargin = safeNum(prof.grossMargin);
  const netMargin = safeNum(prof.netMargin);

  if (netProfit !== 0) {
    const profitLabel = netProfit > 0 ? "profitable" : "unprofitable";
    observations.push({
      type: "profit_status",
      severity: netProfit > 0 ? "info" : "critical",
      message: `The business is ${profitLabel} with a net profit of ${formatCurrency(netProfit)} for ${period}.`,
    });
    if (netProfit < 0) {
      recommendations.push({
        type: "address_losses",
        priority: "critical",
        message: `Business is operating at a loss (${formatCurrency(Math.abs(netProfit))}). Immediate action required to reduce costs or increase revenue.`,
      });
    }
  }

  if (netMargin > 0 && netMargin < LOW_PROFIT_MARGIN_THRESHOLD) {
    observations.push({
      type: "low_profit_margin",
      severity: "warning",
      message: `Net profit margin is ${(netMargin * 100).toFixed(1)}%, which is below the healthy threshold.`,
    });
    recommendations.push({
      type: "improve_margins",
      priority: "medium",
      message: "Work on improving profit margins by reducing costs or adjusting pricing.",
    });
  }

  // Customer insights
  const activeCustomers = safeNum(cust.activeCustomers);
  const newCustomers = safeNum(cust.newCustomers);
  const repeatRate = safeNum(cust.repeatRate);

  if (activeCustomers > 0) {
    observations.push({
      type: "customer_activity",
      severity: "info",
      message: `${activeCustomers} active customer(s) with ${newCustomers} new customer(s) in ${period}.`,
    });
    if (repeatRate > 0) {
      observations.push({
        type: "customer_retention",
        severity: "info",
        message: `Customer repeat rate is ${(repeatRate * 100).toFixed(1)}%.`,
      });
    }
    if (activeCustomers < LOW_CUSTOMER_ACTIVITY_THRESHOLD && totalRevenue > 0) {
      recommendations.push({
        type: "boost_customer_base",
        priority: "medium",
        message: "Customer activity is low. Consider marketing or loyalty programs to attract and retain customers.",
      });
    }
  }

  // Service insights
  if (svc.length > 0) {
    const topService = svc[0];
    observations.push({
      type: "top_service",
      severity: "info",
      message: `Top service: "${topService.name}" generated ${formatCurrency(safeNum(topService.revenue))} in revenue.`,
    });
    if (svc.length > 1) {
      const bottomService = svc[svc.length - 1];
      observations.push({
        type: "service_comparison",
        severity: "info",
        message: `"${topService.name}" outperforms "${bottomService.name}" by ${formatCurrency(safeNum(topService.revenue) - safeNum(bottomService.revenue))}.`,
      });
    }
  }

  // Risk observations
  const risks = evidence.risks || [];
  for (const risk of risks) {
    observations.push({
      type: "detected_risk",
      severity: risk.severity || "warning",
      message: risk.message,
    });
    if (risk.action) {
      recommendations.push({
        type: "risk_mitigation",
        priority: risk.priority || "high",
        message: risk.action,
      });
    }
  }

  // Reporting context
  const repMeta = evidence.reportingMetadata;
  if (repMeta) {
    observations.push({
      type: "reporting_context",
      severity: "info",
      message: `Analysis based on ${repMeta.reportingMode || "CURRENT_OPERATIONAL"} mode. Period: ${repMeta.period || period}. Confidence: ${repMeta.confidence || "MEDIUM"}.`,
    });
  }

  // Errors
  if (evidence.errors.length > 0) {
    for (const err of evidence.errors) {
      observations.push({
        type: "tool_error",
        severity: "error",
        message: `Could not retrieve data from "${err.tool}". ${_userFriendlyError(err)}`,
      });
    }
  }

  if (evidence.missing.length > 0) {
    observations.push({
      type: "missing_data",
      severity: "info",
      message: evidence.missing.join("; "),
    });
  }

  return { observations, recommendations };
}

function formatCurrency(v) {
  const n = safeNum(v);
  return `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function _isDbError(msg) {
  if (!msg) return false;
  const lower = msg.toLowerCase();
  return lower.includes("syntax error") || lower.includes("relation") ||
    lower.includes("column") || lower.includes("does not exist") ||
    lower.includes("null value") || lower.includes("not null") ||
    lower.includes("violates") || lower.includes("unique constraint") ||
    lower.includes("foreign key") || lower.includes("deadlock") ||
    lower.includes("connection") || lower.includes("timeout") ||
    lower.includes("connect");
}

function _userFriendlyError(err) {
  const msg = (err.error || "").toLowerCase();
  if (!msg) return "The system encountered an issue while retrieving this information.";
  if (_isDbError(msg)) return "This module is currently unavailable. Please try again later.";
  if (msg.includes("not authorised") || msg.includes("not authorised") || msg.includes("permission") || msg.includes("access denied")) {
    return "Your account does not have permission to access this information.";
  }
  if (msg.includes("not found") || msg.includes("no such") || msg.includes("does not exist")) {
    return "The requested information was not found in the system.";
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return "The request took too long to complete. Please try again.";
  }
  return "An unexpected error occurred while retrieving this information.";
}

module.exports = { generateInsights, _userFriendlyError };

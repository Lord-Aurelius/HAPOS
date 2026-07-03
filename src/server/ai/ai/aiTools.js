"use strict";

const AI_TOOL_CATALOG = Object.freeze([

  // ── Revenue ──────────────────────────────────────────────────────────

  {
    id: "revenueSummary",
    category: "Revenue",
    type: "read",
    risk: "low",
    description:
      "Summarise daily, weekly, or monthly revenue. Supports date range, period grouping, and branch filtering.",
  },
  {
    id: "revenueTrends",
    category: "Revenue",
    type: "read",
    risk: "low",
    description:
      "Analyse revenue trends over time including growth rates, comparisons, and period-over-period changes.",
  },
  {
    id: "serviceRevenueBreakdown",
    category: "Revenue",
    type: "read",
    risk: "low",
    description:
      "Break down revenue by service, staff, or branch for a given period.",
  },

  // ── Expenses ─────────────────────────────────────────────────────────

  {
    id: "expenseAnalysis",
    category: "Expenses",
    type: "read",
    risk: "low",
    description:
      "Analyse spending patterns, expense categories, and cost trends over a specified period.",
  },
  {
    id: "unusualExpenses",
    category: "Expenses",
    type: "read",
    risk: "medium",
    description:
      "Detect unusual or anomalous expenses that deviate from normal spending patterns.",
  },

  // ── Profitability ────────────────────────────────────────────────────

  {
    id: "profitAnalysis",
    category: "Profitability",
    type: "read",
    risk: "low",
    description:
      "Analyse gross profit, net profit, and profit margins with period comparisons.",
  },
  {
    id: "profitMarginBreakdown",
    category: "Profitability",
    type: "read",
    risk: "low",
    description:
      "Break down profit margins by service, branch, or staff member.",
  },

  // ── Customers ────────────────────────────────────────────────────────

  {
    id: "customerIntelligence",
    category: "Customers",
    type: "read",
    risk: "low",
    description:
      "Analyse repeat customers, customer lifetime value, spending patterns, and retention metrics.",
  },
  {
    id: "topCustomers",
    category: "Customers",
    type: "read",
    risk: "low",
    description:
      "Identify top-spending customers and their contribution to total revenue.",
  },
  {
    id: "customerActivity",
    category: "Customers",
    type: "read",
    risk: "low",
    description:
      "Analyse customer visit frequency, last visit dates, and overall engagement levels.",
  },

  // ── Services ─────────────────────────────────────────────────────────

  {
    id: "serviceIntelligence",
    category: "Services",
    type: "read",
    risk: "low",
    description:
      "Analyse service performance including popularity, revenue contribution, and demand trends.",
  },
  {
    id: "serviceProfitability",
    category: "Services",
    type: "read",
    risk: "low",
    description:
      "Identify most and least profitable services based on revenue and cost data.",
  },

  // ── Sales & Transactions ─────────────────────────────────────────────

  {
    id: "salesSummary",
    category: "Sales",
    type: "read",
    risk: "low",
    description:
      "Summarise sales volume, transaction counts, average ticket size, and payment method breakdown.",
  },
  {
    id: "invoiceStatus",
    category: "Sales",
    type: "read",
    risk: "medium",
    description:
      "Analyse invoice status distribution: paid, unpaid, overdue, cancelled.",
  },

  // ── Forecasting ──────────────────────────────────────────────────────

  {
    id: "revenueForecast",
    category: "Forecasting",
    type: "read",
    risk: "low",
    description:
      "Generate revenue forecast for upcoming periods based on historical trends.",
  },
  {
    id: "expenseForecast",
    category: "Forecasting",
    type: "read",
    risk: "low",
    description:
      "Generate expense forecast based on historical spending patterns.",
  },
  {
    id: "demandForecast",
    category: "Forecasting",
    type: "read",
    risk: "low",
    description:
      "Forecast demand for services based on historical booking and sales data.",
  },

  // ── Risk ─────────────────────────────────────────────────────────────

  {
    id: "riskDetection",
    category: "Risk",
    type: "read",
    risk: "medium",
    description:
      "Identify business risks including revenue decline, expense spikes, falling profits, reduced customer activity, and cash flow issues.",
  },
  {
    id: "cashFlowAnalysis",
    category: "Risk",
    type: "read",
    risk: "medium",
    description:
      "Analyse cash flow position including inflows, outflows, and net cash position.",
  },

  // ── Opportunities ────────────────────────────────────────────────────

  {
    id: "opportunityDetection",
    category: "Opportunities",
    type: "read",
    risk: "low",
    description:
      "Identify business growth opportunities: revenue growth areas, cost reductions, upselling, cross-selling, and seasonal trends.",
  },
  {
    id: "staffPerformance",
    category: "Opportunities",
    type: "read",
    risk: "medium",
    description:
      "Analyse staff performance by revenue generated, services rendered, and customer satisfaction.",
  },

  // ── Business Health ──────────────────────────────────────────────────

  {
    id: "businessHealthScore",
    category: "Business Health",
    type: "read",
    risk: "low",
    description:
      "Generate a composite business health score based on revenue, expenses, profit, customer activity, and risk factors.",
  },
  {
    id: "executiveSummary",
    category: "Business Health",
    type: "read",
    risk: "low",
    description:
      "Generate a comprehensive executive summary of business performance with key metrics and recommendations.",
  },

  // ── Supplier / Inventory (future-ready) ──────────────────────────────

  {
    id: "supplierInsights",
    category: "Suppliers",
    type: "read",
    risk: "low",
    description:
      "Analyse supplier spending, payment patterns, and supplier performance.",
  },

  // ── Tax & Compliance ─────────────────────────────────────────────────

  {
    id: "taxSummary",
    category: "Tax",
    type: "read",
    risk: "medium",
    description:
      "Summarise tax collected, tax liabilities, and tax period comparisons.",
  },
]);

const ROLES = Object.freeze(["super_admin", "shop_admin", "staff"]);

const ROLE_TOOLS = Object.freeze({

  super_admin: Object.freeze([
    "revenueSummary",
    "revenueTrends",
    "serviceRevenueBreakdown",
    "expenseAnalysis",
    "unusualExpenses",
    "profitAnalysis",
    "profitMarginBreakdown",
    "customerIntelligence",
    "topCustomers",
    "customerActivity",
    "serviceIntelligence",
    "serviceProfitability",
    "salesSummary",
    "invoiceStatus",
    "revenueForecast",
    "expenseForecast",
    "demandForecast",
    "riskDetection",
    "cashFlowAnalysis",
    "opportunityDetection",
    "staffPerformance",
    "businessHealthScore",
    "executiveSummary",
    "supplierInsights",
    "taxSummary",
  ]),

  shop_admin: Object.freeze([
    "revenueSummary",
    "revenueTrends",
    "serviceRevenueBreakdown",
    "expenseAnalysis",
    "unusualExpenses",
    "profitAnalysis",
    "profitMarginBreakdown",
    "customerIntelligence",
    "topCustomers",
    "customerActivity",
    "serviceIntelligence",
    "serviceProfitability",
    "salesSummary",
    "invoiceStatus",
    "revenueForecast",
    "expenseForecast",
    "demandForecast",
    "riskDetection",
    "cashFlowAnalysis",
    "opportunityDetection",
    "staffPerformance",
    "businessHealthScore",
    "executiveSummary",
    "supplierInsights",
    "taxSummary",
  ]),

  staff: Object.freeze([
    "revenueSummary",
    "salesSummary",
    "customerIntelligence",
    "customerActivity",
    "serviceIntelligence",
  ]),
});

const _CATALOG_INDEX = Object.freeze(
  AI_TOOL_CATALOG.reduce((acc, tool) => {
    acc[tool.id] = tool;
    return acc;
  }, {})
);

function toolsForRole(role) {
  return Array.from(ROLE_TOOLS[role] ?? []);
}

function toolDefinitionsForRole(role) {
  return toolsForRole(role)
    .map((id) => _CATALOG_INDEX[id])
    .filter(Boolean);
}

function readToolsForRole(role) {
  return toolDefinitionsForRole(role)
    .filter((tool) => tool.type === "read")
    .map((tool) => tool.id);
}

function actionToolsForRole(role) {
  return toolDefinitionsForRole(role)
    .filter((tool) => tool.type === "action")
    .map((tool) => tool.id);
}

function isToolAllowed(role, toolId) {
  const permitted = ROLE_TOOLS[role];
  if (!permitted) return false;
  return permitted.includes(toolId);
}

function highRiskToolsForRole(role) {
  return toolDefinitionsForRole(role)
    .filter((tool) => tool.risk === "high" || tool.risk === "critical")
    .map((tool) => tool.id);
}

function requiresConfirmation(toolId) {
  const tool = _CATALOG_INDEX[toolId];
  if (!tool) return false;
  return tool.risk === "high" || tool.risk === "critical";
}

module.exports = Object.freeze({
  AI_TOOL_CATALOG,
  ROLE_TOOLS,
  toolsForRole,
  toolDefinitionsForRole,
  readToolsForRole,
  actionToolsForRole,
  isToolAllowed,
  highRiskToolsForRole,
  requiresConfirmation,
});

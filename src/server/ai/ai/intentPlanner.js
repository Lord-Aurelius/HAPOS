"use strict";

const { allToolMetadata } = require("./toolRegistry");

const INTENT_MAP = Object.freeze([
  {
    intent: "revenue_query",
    keywords: [
      "revenue", "income", "sales", "earnings", "how much money",
      "how much did we make", "turnover", "top line",
    ],
    toolChain: ["revenueSummary", "revenueTrends"],
    description: "User wants revenue or income information",
  },
  {
    intent: "expense_query",
    keywords: [
      "expense", "spending", "cost", "spent", "overhead",
      "outgoing", "what did we spend", "costs",
    ],
    toolChain: ["expenseAnalysis", "unusualExpenses"],
    description: "User wants expense or spending information",
  },
  {
    intent: "profit_query",
    keywords: [
      "profit", "profitability", "margin", "bottom line",
      "net income", "gross profit", "net profit", "earnings",
    ],
    toolChain: ["profitAnalysis", "profitMarginBreakdown"],
    description: "User wants profit or profitability information",
  },
  {
    intent: "customer_query",
    keywords: [
      "customer", "client", "who spends", "repeat customer",
      "loyalty", "retention", "customer lifetime",
    ],
    toolChain: ["customerIntelligence", "topCustomers"],
    description: "User wants customer information or insights",
  },
  {
    intent: "service_query",
    keywords: [
      "service", "treatment", "offering", "most popular",
      "best selling", "top service", "service performance",
    ],
    toolChain: ["serviceIntelligence", "serviceProfitability"],
    description: "User wants service performance information",
  },
  {
    intent: "forecast_query",
    keywords: [
      "forecast", "predict", "projection", "expected",
      "next month", "coming month", "future revenue",
      "will we make", "trend",
    ],
    toolChain: ["revenueForecast", "expenseForecast"],
    description: "User wants forecast or prediction",
  },
  {
    intent: "risk_query",
    keywords: [
      "risk", "concern", "warning", "decline", "drop",
      "decrease", "problem", "issue", "cash flow",
      "insolvent", "losing money",
    ],
    toolChain: ["riskDetection", "cashFlowAnalysis"],
    description: "User wants risk assessment or issue detection",
  },
  {
    intent: "opportunity_query",
    keywords: [
      "opportunity", "growth", "improve", "promote",
      "upsell", "cross-sell", "recommendation",
      "should we", "action", "suggestion",
    ],
    toolChain: ["opportunityDetection", "executiveSummary"],
    description: "User wants growth opportunities or recommendations",
  },
  {
    intent: "business_health",
    keywords: [
      "health", "overview", "summary", "how is the business",
      "business performance", "dashboard", "status",
      "how are we doing", "performance review",
    ],
    toolChain: ["businessHealthScore", "executiveSummary"],
    description: "User wants overall business health or summary",
  },
  {
    intent: "staff_query",
    keywords: [
      "staff", "employee", "team", "who performed",
      "top performer", "staff performance",
    ],
    toolChain: ["staffPerformance", "serviceRevenueBreakdown"],
    description: "User wants staff performance information",
  },
  {
    intent: "sales_query",
    keywords: [
      "transaction", "sale", "invoice", "receipt",
      "payment", "paid", "unpaid", "ticket size",
      "average sale",
    ],
    toolChain: ["salesSummary", "invoiceStatus"],
    description: "User wants sales or transaction information",
  },
]);

const TOOL_NAMES = {
  revenueSummary: "Revenue Summary",
  revenueTrends: "Revenue Trends",
  serviceRevenueBreakdown: "Service Revenue Breakdown",
  expenseAnalysis: "Expense Analysis",
  unusualExpenses: "Unusual Expenses",
  profitAnalysis: "Profit Analysis",
  profitMarginBreakdown: "Profit Margin Breakdown",
  customerIntelligence: "Customer Intelligence",
  topCustomers: "Top Customers",
  customerActivity: "Customer Activity",
  serviceIntelligence: "Service Intelligence",
  serviceProfitability: "Service Profitability",
  salesSummary: "Sales Summary",
  invoiceStatus: "Invoice Status",
  revenueForecast: "Revenue Forecast",
  expenseForecast: "Expense Forecast",
  demandForecast: "Demand Forecast",
  riskDetection: "Risk Detection",
  cashFlowAnalysis: "Cash Flow Analysis",
  opportunityDetection: "Opportunity Detection",
  staffPerformance: "Staff Performance",
  businessHealthScore: "Business Health Score",
  executiveSummary: "Executive Summary",
  supplierInsights: "Supplier Insights",
  taxSummary: "Tax Summary",
};

const REPORTING_KEYWORDS = Object.freeze([
  { mode: "DAILY", keywords: ["today", "daily", "this day"] },
  { mode: "WEEKLY", keywords: ["this week", "weekly", "past week", "last week"] },
  { mode: "MONTHLY", keywords: ["this month", "monthly", "past month", "last month"] },
  { mode: "QUARTERLY", keywords: ["this quarter", "quarterly", "past quarter", "last quarter"] },
  { mode: "YEARLY", keywords: ["this year", "yearly", "annual", "year to date", "ytd"] },
]);

const _STOP_WORDS = new Set(["what", "which", "show", "list", "all", "available", "of", "my", "your", "the", "a", "an", "any", "this", "that"]);

function detectTimePeriod(message) {
  const lower = message.toLowerCase().trim();
  for (const entry of REPORTING_KEYWORDS) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) return entry.mode;
    }
  }
  return null;
}

function planIntents(message) {
  const lower = message.toLowerCase().trim();
  if (!lower) return { intents: [], toolChain: [], timePeriod: null };

  const scored = [];

  for (const entry of INTENT_MAP) {
    let score = 0;
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) score += kw.split(" ").length;
    }
    if (score > 0) {
      scored.push({ intent: entry.intent, score, toolChain: entry.toolChain, description: entry.description });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  const intents = scored.map((s) => ({ intent: s.intent, description: s.description }));
  const bestChain = scored.length > 0 ? scored[0].toolChain : [];

  const timePeriod = detectTimePeriod(message);

  return { intents, toolChain: bestChain, timePeriod };
}

function buildPlannerMessage(message) {
  const plan = planIntents(message);
  const parts = [`## AI Tool Planning Guide`];

  const allMeta = allToolMetadata();
  const registeredIds = new Set(allMeta.map((m) => m.id));

  if (plan.toolChain.length > 0 && plan.toolChain.every((id) => registeredIds.has(id))) {
    const toolNames = plan.toolChain
      .filter((id) => TOOL_NAMES[id])
      .map((id) => TOOL_NAMES[id]);
    parts.push(`\n### Suggested tool chain for this query:`);
    parts.push(toolNames.map((n, i) => `${i + 1}. ${n}`).join("\n"));
    if (plan.timePeriod) {
      parts.push(`\nDetected time period: "${plan.timePeriod}". Use this to scope your analysis.`);
    }
    if (plan.intents.length > 0) {
      parts.push(`\nDetected intent(s): ${plan.intents.map((i) => i.intent).join(", ")}`);
    }
  } else {
    parts.push(`\nNo specific intent detected. Use the available tools below to answer the user's question.`);
  }

  parts.push(`\n### Available tools by category:`);

  const byCat = {};
  for (const m of allMeta) {
    if (!byCat[m.category]) byCat[m.category] = [];
    byCat[m.category].push({ id: m.id, name: TOOL_NAMES[m.id] || m.name, desc: m.description });
  }
  for (const [cat, tools] of Object.entries(byCat)) {
    parts.push(`\n**${cat}**:`);
    for (const t of tools) {
      parts.push(`- \`${t.id}\`: ${t.desc}`);
    }
  }

  return parts.join("\n");
}

module.exports = { planIntents, buildPlannerMessage, detectTimePeriod };

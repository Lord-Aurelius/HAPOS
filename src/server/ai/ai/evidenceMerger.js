"use strict";

function getData(result) {
  if (!result || !result.success) return null;
  return result.data || result;
}

function extractArray(obj, key) {
  if (!obj) return [];
  const v = obj[key];
  return Array.isArray(v) ? v : Array.isArray(obj) ? obj : [];
}

function safeNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function _extractMetadata(tr) {
  const meta = tr.result?.metadata;
  if (!meta) return null;
  if (!meta.reportingMode && !meta.period) return null;
  return {
    period: meta.period || null,
    reportingMode: meta.reportingMode || "CURRENT_OPERATIONAL",
    confidence: meta.confidence || "MEDIUM",
    generatedAt: meta.timestamp || new Date().toISOString(),
  };
}

function _pickBestMetadata(evidence, newMeta) {
  if (!newMeta) return;
  if (!evidence.reportingMetadata || newMeta.confidence === "HIGH") {
    evidence.reportingMetadata = newMeta;
  }
}

function mergeToolResults(toolResults) {
  const evidence = {
    revenue: {},
    expenses: {},
    profit: {},
    customers: {},
    services: [],
    sales: {},
    risks: [],
    opportunities: [],
    cashFlow: {},
    staff: [],
    suppliers: {},
    tax: {},
    healthScore: null,
    reportingMetadata: null,
    missing: [],
    errors: [],
    period: null,
  };

  for (const tr of toolResults) {
    const data = getData(tr.result);
    if (!data) {
      evidence.errors.push({ tool: tr.toolId, error: tr.result?.error || "unknown", args: tr.args });
      continue;
    }

    const meta = _extractMetadata(tr);
    _pickBestMetadata(evidence, meta);

    try {
      switch (tr.toolId) {
        case "revenueSummary":
        case "revenueTrends":
          evidence.revenue = { ...evidence.revenue, ...data };
          if (data.period) evidence.period = data.period;
          break;

        case "expenseAnalysis":
          evidence.expenses = { ...evidence.expenses, ...data };
          break;

        case "unusualExpenses":
          evidence.unusualExpenses = extractArray(data, "unusualExpenses");
          break;

        case "profitAnalysis":
          evidence.profit = { ...evidence.profit, ...data };
          break;

        case "customerIntelligence":
        case "topCustomers":
          evidence.customers = { ...evidence.customers, ...data };
          break;

        case "serviceIntelligence":
        case "serviceProfitability":
          evidence.services = extractArray(data, "services");
          break;

        case "salesSummary":
          evidence.sales = { ...evidence.sales, ...data };
          break;

        case "invoiceStatus":
          evidence.invoiceStatus = data;
          break;

        case "riskDetection":
          evidence.risks = extractArray(data, "risks");
          break;

        case "cashFlowAnalysis":
          evidence.cashFlow = { ...evidence.cashFlow, ...data };
          break;

        case "opportunityDetection":
          evidence.opportunities = extractArray(data, "opportunities");
          break;

        case "staffPerformance":
          evidence.staff = extractArray(data, "staff");
          break;

        case "businessHealthScore":
          evidence.healthScore = data;
          break;

        case "executiveSummary":
          evidence.executiveSummary = data;
          break;

        case "revenueForecast":
        case "expenseForecast":
        case "demandForecast":
          evidence.forecast = { ...(evidence.forecast || {}), ...data };
          break;

        case "taxSummary":
          evidence.tax = { ...evidence.tax, ...data };
          break;
      }
    } catch (e) {
      evidence.errors.push({ tool: tr.toolId, error: e.message, args: tr.args });
    }
  }

  return evidence;
}

module.exports = { mergeToolResults };

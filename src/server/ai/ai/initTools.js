const { registerTool, registryHealth } = require("./toolRegistry");
const BI = require("./tools/businessIntelligenceRepository");
const { createRevenueSummaryTool } = require("./tools/revenueSummaryTool");
const { createRevenueTrendsTool } = require("./tools/revenueTrendsTool");
const { createServiceRevenueBreakdownTool } = require("./tools/serviceRevenueBreakdownTool");
const { createRevenueByEmployeeTool } = require("./tools/revenueByEmployeeTool");
const { createRevenueByServiceTool } = require("./tools/revenueByServiceTool");
const { createRevenueByPaymentMethodTool } = require("./tools/revenueByPaymentMethodTool");
const { createRevenueByBranchTool } = require("./tools/revenueByBranchTool");
const { createExpenseAnalysisTool } = require("./tools/expenseAnalysisTool");
const { createUnusualExpensesTool } = require("./tools/unusualExpensesTool");
const { createProfitAnalysisTool } = require("./tools/profitAnalysisTool");
const { createProfitMarginBreakdownTool } = require("./tools/profitMarginBreakdownTool");
const { createCustomerIntelligenceTool } = require("./tools/customerIntelligenceTool");
const { createTopCustomersTool } = require("./tools/topCustomersTool");
const { createCustomerActivityTool } = require("./tools/customerActivityTool");
const { createServiceIntelligenceTool } = require("./tools/serviceIntelligenceTool");
const { createServiceProfitabilityTool } = require("./tools/serviceProfitabilityTool");
const { createSalesSummaryTool } = require("./tools/salesSummaryTool");
const { createInvoiceStatusTool } = require("./tools/invoiceStatusTool");
const { createRevenueForecastTool } = require("./tools/revenueForecastTool");
const { createExpenseForecastTool } = require("./tools/expenseForecastTool");
const { createDemandForecastTool } = require("./tools/demandForecastTool");
const { createRiskDetectionTool } = require("./tools/riskDetectionTool");
const { createCashFlowAnalysisTool } = require("./tools/cashFlowAnalysisTool");
const { createOpportunityDetectionTool } = require("./tools/opportunityDetectionTool");
const { createStaffPerformanceTool } = require("./tools/staffPerformanceTool");
const { createBusinessHealthScoreTool } = require("./tools/businessHealthScoreTool");
const { createExecutiveSummaryTool } = require("./tools/executiveSummaryTool");
const { createBranchPerformanceTool } = require("./tools/branchPerformanceTool");
const { createSearchBusinessDataTool } = require("./tools/searchBusinessDataTool");
const { createDashboardDataTool } = require("./tools/dashboardDataTool");

const biRepo = BI;

function safeRegister(toolId, factory) {
  try {
    const tool = factory();
    registerTool(toolId, tool);
  } catch (error) {
    if (error.message?.includes("already registered")) return;
    console.warn(`Failed to register ${toolId}:`, error.message);
  }
}

function initTools() {
  safeRegister("revenueSummary", () => createRevenueSummaryTool(biRepo));
  safeRegister("revenueTrends", () => createRevenueTrendsTool(biRepo));
  safeRegister("serviceRevenueBreakdown", () => createServiceRevenueBreakdownTool(biRepo));
  safeRegister("revenueByEmployee", () => createRevenueByEmployeeTool(biRepo));
  safeRegister("revenueByService", () => createRevenueByServiceTool(biRepo));
  safeRegister("revenueByPaymentMethod", () => createRevenueByPaymentMethodTool(biRepo));
  safeRegister("revenueByBranch", () => createRevenueByBranchTool(biRepo));
  safeRegister("expenseAnalysis", () => createExpenseAnalysisTool(biRepo));
  safeRegister("unusualExpenses", () => createUnusualExpensesTool(biRepo));
  safeRegister("profitAnalysis", () => createProfitAnalysisTool(biRepo));
  safeRegister("profitMarginBreakdown", () => createProfitMarginBreakdownTool(biRepo));
  safeRegister("customerIntelligence", () => createCustomerIntelligenceTool(biRepo));
  safeRegister("topCustomers", () => createTopCustomersTool(biRepo));
  safeRegister("customerActivity", () => createCustomerActivityTool(biRepo));
  safeRegister("serviceIntelligence", () => createServiceIntelligenceTool(biRepo));
  safeRegister("serviceProfitability", () => createServiceProfitabilityTool(biRepo));
  safeRegister("salesSummary", () => createSalesSummaryTool(biRepo));
  safeRegister("invoiceStatus", () => createInvoiceStatusTool(biRepo));
  safeRegister("revenueForecast", () => createRevenueForecastTool(biRepo));
  safeRegister("expenseForecast", () => createExpenseForecastTool(biRepo));
  safeRegister("demandForecast", () => createDemandForecastTool(biRepo));
  safeRegister("riskDetection", () => createRiskDetectionTool(biRepo));
  safeRegister("cashFlowAnalysis", () => createCashFlowAnalysisTool(biRepo));
  safeRegister("opportunityDetection", () => createOpportunityDetectionTool(biRepo));
  safeRegister("staffPerformance", () => createStaffPerformanceTool(biRepo));
  safeRegister("businessHealthScore", () => createBusinessHealthScoreTool(biRepo));
  safeRegister("executiveSummary", () => createExecutiveSummaryTool(biRepo));
  safeRegister("branchPerformance", () => createBranchPerformanceTool(biRepo));
  safeRegister("searchBusinessData", () => createSearchBusinessDataTool(biRepo));
  safeRegister("dashboardData", () => createDashboardDataTool(biRepo));

  const health = registryHealth();
  if (health.unregistered > 0) {
    console.warn(`AI tools: ${health.registered}/${health.totalCatalogued} registered. Missing: ${health.missingTools.join(", ")}`);
  }
  return health;
}

function runStartupDiagnostics(health, env) {
  console.log("=".repeat(60));
  console.log("AEGIS Startup Diagnostics");
  console.log("=".repeat(60));
  console.log(`AI Enabled:     ${env?.ai?.enabled ? "YES" : "NO"}`);
  console.log(`Provider:       ${env?.ai?.defaultProvider || "disabled"}`);
  if (env?.ai?.ollamaBaseUrl) {
    console.log(`Ollama URL:     ${env.ai.ollamaBaseUrl}`);
    console.log(`Ollama Model:   ${env.ai.ollamaModel || "default"}`);
  }
  console.log(`Tools:          ${health.registered}/${health.totalCatalogued} registered`);
  if (health.missingTools.length > 0) {
    console.log(`Missing tools:  ${health.missingTools.join(", ")}`);
  }
  console.log(`Memory Store:   In-memory (conversation + entities)`);
  console.log(`Agent Loop:     Enabled (max ${require("./aiService").FUTURE_CAPABILITIES ? "10" : "10"} steps)`);
  console.log("=".repeat(60));
}

// Auto-initialise tools on module load (tool registration does not depend on env vars)
const initHealth = initTools();

// NOTE: runStartupDiagnostics is NOT called here because requiring env.js at module level
// would freeze process.env at build time, preventing Render's runtime env vars from being used.
// It is called lazily by the health endpoint instead.

module.exports = { initTools, runStartupDiagnostics, initHealth };

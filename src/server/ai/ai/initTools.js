const { registerTool, registryHealth } = require("./toolRegistry");
const BI = require("./tools/businessIntelligenceRepository");
const { createRevenueSummaryTool } = require("./tools/revenueSummaryTool");
const { createRevenueTrendsTool } = require("./tools/revenueTrendsTool");
const { createExpenseAnalysisTool } = require("./tools/expenseAnalysisTool");
const { createUnusualExpensesTool } = require("./tools/unusualExpensesTool");
const { createProfitAnalysisTool } = require("./tools/profitAnalysisTool");
const { createCustomerIntelligenceTool } = require("./tools/customerIntelligenceTool");
const { createServiceIntelligenceTool } = require("./tools/serviceIntelligenceTool");
const { createSalesSummaryTool } = require("./tools/salesSummaryTool");
const { createStaffPerformanceTool } = require("./tools/staffPerformanceTool");
const { createRiskDetectionTool } = require("./tools/riskDetectionTool");
const { createCashFlowAnalysisTool } = require("./tools/cashFlowAnalysisTool");
const { createOpportunityDetectionTool } = require("./tools/opportunityDetectionTool");

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
  safeRegister("expenseAnalysis", () => createExpenseAnalysisTool(biRepo));
  safeRegister("unusualExpenses", () => createUnusualExpensesTool(biRepo));
  safeRegister("profitAnalysis", () => createProfitAnalysisTool(biRepo));
  safeRegister("customerIntelligence", () => createCustomerIntelligenceTool(biRepo));
  safeRegister("serviceIntelligence", () => createServiceIntelligenceTool(biRepo));
  safeRegister("salesSummary", () => createSalesSummaryTool(biRepo));
  safeRegister("staffPerformance", () => createStaffPerformanceTool(biRepo));
  safeRegister("riskDetection", () => createRiskDetectionTool(biRepo));
  safeRegister("cashFlowAnalysis", () => createCashFlowAnalysisTool(biRepo));
  safeRegister("opportunityDetection", () => createOpportunityDetectionTool(biRepo));

  const health = registryHealth();
  if (health.unregistered > 0) {
    console.warn(`AI tools: ${health.registered}/${health.totalCatalogued} registered. Missing: ${health.missingTools.join(", ")}`);
  }
  return health;
}

function runStartupDiagnostics(health, env) {
  console.log("=".repeat(60));
  console.log("HAPOS AI Startup Diagnostics");
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

module.exports = { initTools, runStartupDiagnostics };

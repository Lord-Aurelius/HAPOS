"use strict";

const { createBusinessTool } = require("./baseBusinessTool");

function createCashFlowAnalysisTool(repo) {
  return createBusinessTool({
    id: "cashFlowAnalysis",
    name: "Cash Flow Analysis",
    description: "Analyse cash flow position including inflows, outflows, and net cash position.",
    category: "Risk",
    risk: "medium",
    repo,
    method: "getCashFlowAnalysis",
  });
}

module.exports = { createCashFlowAnalysisTool };

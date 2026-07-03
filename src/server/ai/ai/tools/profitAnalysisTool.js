"use strict";

const { createBusinessTool } = require("./baseBusinessTool");

function createProfitAnalysisTool(repo) {
  return createBusinessTool({
    id: "profitAnalysis",
    name: "Profit Analysis",
    description: "Analyse gross profit, net profit, and profit margins with period comparisons.",
    category: "Profitability",
    risk: "low",
    repo,
    method: "getProfitAnalysis",
  });
}

module.exports = { createProfitAnalysisTool };

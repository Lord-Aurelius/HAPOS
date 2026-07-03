"use strict";

const { createBusinessTool } = require("./baseBusinessTool");

function createExpenseAnalysisTool(repo) {
  return createBusinessTool({
    id: "expenseAnalysis",
    name: "Expense Analysis",
    description: "Analyse spending patterns, expense categories, and cost trends over a specified period.",
    category: "Expenses",
    risk: "low",
    repo,
    method: "getExpenseAnalysis",
  });
}

module.exports = { createExpenseAnalysisTool };

"use strict";

const { createBusinessTool } = require("./baseBusinessTool");

function createUnusualExpensesTool(repo) {
  return createBusinessTool({
    id: "unusualExpenses",
    name: "Unusual Expenses",
    description: "Detect unusual or anomalous expenses that deviate from normal spending patterns.",
    category: "Expenses",
    risk: "medium",
    repo,
    method: "getUnusualExpenses",
  });
}

module.exports = { createUnusualExpensesTool };

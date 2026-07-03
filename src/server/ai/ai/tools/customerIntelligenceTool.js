"use strict";

const { createBusinessTool } = require("./baseBusinessTool");

function createCustomerIntelligenceTool(repo) {
  return createBusinessTool({
    id: "customerIntelligence",
    name: "Customer Intelligence",
    description: "Analyse repeat customers, customer lifetime value, spending patterns, and retention metrics.",
    category: "Customers",
    risk: "low",
    repo,
    method: "getCustomerIntelligence",
  });
}

module.exports = { createCustomerIntelligenceTool };

"use strict";

const { createBusinessTool } = require("./baseBusinessTool");

function createSalesSummaryTool(repo) {
  return createBusinessTool({
    id: "salesSummary",
    name: "Sales Summary",
    description: "Summarise sales volume, transaction counts, average ticket size, and payment method breakdown.",
    category: "Sales",
    risk: "low",
    repo,
    method: "getSalesSummary",
  });
}

module.exports = { createSalesSummaryTool };

"use strict";

const { createBusinessTool } = require("./baseBusinessTool");

function createRevenueTrendsTool(repo) {
  return createBusinessTool({
    id: "revenueTrends",
    name: "Revenue Trends",
    description: "Analyse revenue trends over time including growth rates, comparisons, and period-over-period changes.",
    category: "Revenue",
    risk: "low",
    repo,
    method: "getRevenueTrends",
  });
}

module.exports = { createRevenueTrendsTool };

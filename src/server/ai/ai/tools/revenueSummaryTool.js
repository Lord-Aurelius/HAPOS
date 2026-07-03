"use strict";

const { createBusinessTool } = require("./baseBusinessTool");

function createRevenueSummaryTool(repo) {
  return createBusinessTool({
    id: "revenueSummary",
    name: "Revenue Summary",
    description: "Summarise daily, weekly, or monthly revenue. Supports date range, period grouping, and branch filtering.",
    category: "Revenue",
    risk: "low",
    repo,
    method: "getRevenueSummary",
  });
}

module.exports = { createRevenueSummaryTool };

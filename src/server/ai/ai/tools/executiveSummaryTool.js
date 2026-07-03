"use strict";
const { createBusinessTool } = require("./baseBusinessTool");
function createExecutiveSummaryTool(repo) {
  return createBusinessTool({ id: "executiveSummary", name: "Executive Summary", description: "Generate a comprehensive executive summary of business performance with key metrics and recommendations.", category: "Business Health", risk: "low", repo, method: "getExecutiveSummary" });
}
module.exports = { createExecutiveSummaryTool };
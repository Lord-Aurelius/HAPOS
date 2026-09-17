"use strict";
const { createBusinessTool } = require("./baseBusinessTool");
function createProfitMarginBreakdownTool(repo) {
  return createBusinessTool({ id: "profitMarginBreakdown", name: "Profit Margin Breakdown", description: "Break down profit margins by service.", category: "Profitability", risk: "low", repo, method: "getProfitMarginBreakdown" });
}
module.exports = { createProfitMarginBreakdownTool };
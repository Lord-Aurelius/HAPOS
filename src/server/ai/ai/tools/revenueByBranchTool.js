"use strict";
const { createBusinessTool } = require("./baseBusinessTool");
function createRevenueByBranchTool(repo) {
  return createBusinessTool({ id: "revenueByBranch", name: "Revenue by Branch", description: "Break down revenue by branch location.", category: "Revenue", risk: "low", repo, method: "getRevenueByBranch" });
}
module.exports = { createRevenueByBranchTool };
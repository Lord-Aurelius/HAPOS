"use strict";
const { createBusinessTool } = require("./baseBusinessTool");
function createBranchPerformanceTool(repo) {
  return createBusinessTool({ id: "branchPerformance", name: "Branch Performance", description: "Analyse performance by branch: revenue, expenses, profit, and customer counts.", category: "Branches", risk: "low", repo, method: "getBranchPerformance" });
}
module.exports = { createBranchPerformanceTool };
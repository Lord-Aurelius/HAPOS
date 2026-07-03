"use strict";
const { createBusinessTool } = require("./baseBusinessTool");
function createBusinessHealthScoreTool(repo) {
  return createBusinessTool({ id: "businessHealthScore", name: "Business Health Score", description: "Generate a composite business health score based on revenue, expenses, profit, customer activity, and risk factors.", category: "Business Health", risk: "low", repo, method: "getBusinessHealthScore" });
}
module.exports = { createBusinessHealthScoreTool };
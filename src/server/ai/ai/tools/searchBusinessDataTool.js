"use strict";
const { createBusinessTool } = require("./baseBusinessTool");
function createSearchBusinessDataTool(repo) {
  return createBusinessTool({ id: "searchBusinessData", name: "Search Business Data", description: "Search customers, transactions, services, and expenses using natural language queries.", category: "Search", risk: "low", repo, method: "searchBusinessData" });
}
module.exports = { createSearchBusinessDataTool };
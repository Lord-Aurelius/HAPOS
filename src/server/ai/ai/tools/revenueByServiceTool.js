"use strict";
const { createBusinessTool } = require("./baseBusinessTool");
function createRevenueByServiceTool(repo) {
  return createBusinessTool({ id: "revenueByService", name: "Revenue by Service", description: "Break down revenue by individual service offerings.", category: "Revenue", risk: "low", repo, method: "getRevenueByService" });
}
module.exports = { createRevenueByServiceTool };
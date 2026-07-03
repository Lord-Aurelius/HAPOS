"use strict";
const { createBusinessTool } = require("./baseBusinessTool");
function createServiceRevenueBreakdownTool(repo) {
  return createBusinessTool({ id: "serviceRevenueBreakdown", name: "Service Revenue Breakdown", description: "Break down revenue by service, staff, or branch for a given period.", category: "Revenue", risk: "low", repo, method: "getServiceRevenueBreakdown" });
}
module.exports = { createServiceRevenueBreakdownTool };
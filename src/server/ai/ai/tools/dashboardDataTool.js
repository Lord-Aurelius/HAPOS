"use strict";
const { createBusinessTool } = require("./baseBusinessTool");
function createDashboardDataTool(repo) {
  return createBusinessTool({ id: "dashboardData", name: "Dashboard Data", description: "Provide all data required by the HAPOS dashboard: revenue, profit, expenses, health score, risks, opportunities, forecasts, and KPIs.", category: "Dashboard", risk: "low", repo, method: "getDashboardData" });
}
module.exports = { createDashboardDataTool };
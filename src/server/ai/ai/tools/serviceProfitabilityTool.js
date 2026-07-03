"use strict";
const { createBusinessTool } = require("./baseBusinessTool");
function createServiceProfitabilityTool(repo) {
  return createBusinessTool({ id: "serviceProfitability", name: "Service Profitability", description: "Identify most and least profitable services based on revenue and cost data.", category: "Services", risk: "low", repo, method: "getServiceProfitability" });
}
module.exports = { createServiceProfitabilityTool };
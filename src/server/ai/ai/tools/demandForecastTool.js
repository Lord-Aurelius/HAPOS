"use strict";
const { createBusinessTool } = require("./baseBusinessTool");
function createDemandForecastTool(repo) {
  return createBusinessTool({ id: "demandForecast", name: "Demand Forecast", description: "Forecast demand for services based on historical booking and sales data.", category: "Forecasting", risk: "low", repo, method: "getDemandForecast" });
}
module.exports = { createDemandForecastTool };
"use strict";
const { createBusinessTool } = require("./baseBusinessTool");
function createRevenueForecastTool(repo) {
  return createBusinessTool({ id: "revenueForecast", name: "Revenue Forecast", description: "Generate revenue forecast for upcoming periods based on historical trends.", category: "Forecasting", risk: "low", repo, method: "getRevenueForecast" });
}
module.exports = { createRevenueForecastTool };
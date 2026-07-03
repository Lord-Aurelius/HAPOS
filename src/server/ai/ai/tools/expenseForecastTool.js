"use strict";
const { createBusinessTool } = require("./baseBusinessTool");
function createExpenseForecastTool(repo) {
  return createBusinessTool({ id: "expenseForecast", name: "Expense Forecast", description: "Generate expense forecast based on historical spending patterns.", category: "Forecasting", risk: "low", repo, method: "getExpenseForecast" });
}
module.exports = { createExpenseForecastTool };
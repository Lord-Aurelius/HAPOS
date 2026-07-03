"use strict";
const { createBusinessTool } = require("./baseBusinessTool");
function createCustomerActivityTool(repo) {
  return createBusinessTool({ id: "customerActivity", name: "Customer Activity", description: "Analyse customer visit frequency, last visit dates, and overall engagement levels.", category: "Customers", risk: "low", repo, method: "getCustomerActivity" });
}
module.exports = { createCustomerActivityTool };
"use strict";
const { createBusinessTool } = require("./baseBusinessTool");
function createTopCustomersTool(repo) {
  return createBusinessTool({ id: "topCustomers", name: "Top Customers", description: "Identify top-spending customers and their contribution to total revenue.", category: "Customers", risk: "low", repo, method: "getTopCustomers" });
}
module.exports = { createTopCustomersTool };
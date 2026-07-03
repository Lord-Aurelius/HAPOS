"use strict";
const { createBusinessTool } = require("./baseBusinessTool");
function createRevenueByPaymentMethodTool(repo) {
  return createBusinessTool({ id: "revenueByPaymentMethod", name: "Revenue by Payment Method", description: "Break down revenue by payment method (cash, card, mobile money, etc.).", category: "Revenue", risk: "low", repo, method: "getRevenueByPaymentMethod" });
}
module.exports = { createRevenueByPaymentMethodTool };
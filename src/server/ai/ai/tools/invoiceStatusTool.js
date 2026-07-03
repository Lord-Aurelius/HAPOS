"use strict";
const { createBusinessTool } = require("./baseBusinessTool");
function createInvoiceStatusTool(repo) {
  return createBusinessTool({ id: "invoiceStatus", name: "Invoice Status", description: "Analyse invoice status distribution: paid, unpaid, overdue, cancelled.", category: "Sales", risk: "medium", repo, method: "getInvoiceStatus" });
}
module.exports = { createInvoiceStatusTool };
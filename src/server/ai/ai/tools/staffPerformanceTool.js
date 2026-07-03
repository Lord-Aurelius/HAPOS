"use strict";

const { createBusinessTool } = require("./baseBusinessTool");

function createStaffPerformanceTool(repo) {
  return createBusinessTool({
    id: "staffPerformance",
    name: "Staff Performance",
    description: "Analyse staff performance by revenue generated, services rendered, and customer satisfaction.",
    category: "Opportunities",
    risk: "medium",
    repo,
    method: "getStaffPerformance",
  });
}

module.exports = { createStaffPerformanceTool };

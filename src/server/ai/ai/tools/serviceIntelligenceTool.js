"use strict";

const { createBusinessTool } = require("./baseBusinessTool");

function createServiceIntelligenceTool(repo) {
  return createBusinessTool({
    id: "serviceIntelligence",
    name: "Service Intelligence",
    description: "Analyse service performance including popularity, revenue contribution, and demand trends.",
    category: "Services",
    risk: "low",
    repo,
    method: "getServiceIntelligence",
  });
}

module.exports = { createServiceIntelligenceTool };

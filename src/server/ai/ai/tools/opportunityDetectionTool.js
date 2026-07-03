"use strict";

const { createBusinessTool } = require("./baseBusinessTool");

function createOpportunityDetectionTool(repo) {
  return createBusinessTool({
    id: "opportunityDetection",
    name: "Opportunity Detection",
    description: "Identify business growth opportunities: revenue growth areas, cost reductions, upselling, cross-selling, and seasonal trends.",
    category: "Opportunities",
    risk: "low",
    repo,
    method: "getOpportunities",
  });
}

module.exports = { createOpportunityDetectionTool };

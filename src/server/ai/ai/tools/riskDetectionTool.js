"use strict";

const { createBusinessTool } = require("./baseBusinessTool");

function createRiskDetectionTool(repo) {
  return createBusinessTool({
    id: "riskDetection",
    name: "Risk Detection",
    description: "Identify business risks including revenue decline, expense spikes, falling profits, reduced customer activity, and cash flow issues.",
    category: "Risk",
    risk: "medium",
    repo,
    method: "getDetectedRisks",
  });
}

module.exports = { createRiskDetectionTool };

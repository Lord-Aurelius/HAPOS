"use strict";

const BaseTool = require("./baseTool");

class BaseBusinessTool extends BaseTool {
  constructor({ id, name, description, category, risk, repo, method } = {}) {
    super({ id, name, description, category, risk });
    if (!repo || typeof repo[method] !== "function") {
      throw new TypeError(`${name} requires a repo with ${method}()`);
    }
    this.repo = repo;
    this._method = method;
  }

  normalizeArgs(args) {
    if (!args || typeof args !== "object") return args;
    const n = { ...args };
    if (typeof n.period === "string") n.period = n.period.trim().toLowerCase();
    return n;
  }

  async execute({ context, args }) {
    const safeArgs = { ...args };
    delete safeArgs.tenantId;
    const result = await this.repo[this._method]({
      tenantId: context.tenantId,
      userId: context.userId,
      role: context.role,
      period: args.period,
      ...safeArgs,
    });
    return {
      success: true,
      data: result,
      metadata: {
        tool: this.id,
        tenantId: context.tenantId,
        period: args.period || null,
        timestamp: new Date().toISOString(),
        reportingMode: args.period ? args.period.toUpperCase() : "CURRENT_OPERATIONAL",
        confidence: "HIGH",
      },
    };
  }
}

function createBusinessTool({ id, name, description, category, risk, repo, method }) {
  return new BaseBusinessTool({ id, name, description, category, risk, repo, method });
}

module.exports = { BaseBusinessTool, createBusinessTool };

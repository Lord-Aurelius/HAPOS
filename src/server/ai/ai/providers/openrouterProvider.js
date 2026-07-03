"use strict";

const { apiFetch, buildSystemMessage, parseToolCalls } = require("./providerUtils");

function createOpenRouterProvider(config) {
  const apiKey = config.openrouterApiKey || process.env.OPENROUTER_API_KEY || "";
  const model = config.openrouterModel || process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  const baseUrl = (config.openrouterBaseUrl || process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");

  return {
    name: "openrouter",
    model,
    async invoke(request) {
      const endpoint = request.endpoint || "chat";
      const entityContext = request.entityContext || [];
      const tools = request.tools || [];
      const plannerMessage = request.plannerMessage || null;
      const messages = request.messages || [];

      const systemMsg = buildSystemMessage(endpoint, entityContext, plannerMessage);
      const hasSystem = messages.length > 0 && messages[0].role === "system";
      const finalMessages = hasSystem ? [systemMsg, ...messages.slice(1)] : [systemMsg, ...messages];

      const body = { model, messages: finalMessages, stream: false };
      if (tools.length > 0) {
        body.tools = tools;
        body.tool_choice = "auto";
      }
      if (request.payload?.options) Object.assign(body, request.payload.options);

      const response = await apiFetch(baseUrl, "/chat/completions", body, apiKey);

      if (response.status >= 400) {
        return { status: "error", content: `OpenRouter API error: ${response.data?.error?.message || response.status}`, toolCalls: null, metadata: { endpoint, model, mode: "openrouter", statusCode: response.status } };
      }

      const choice = response.data?.choices?.[0] || {};
      const message = choice.message || {};
      const toolCalls = parseToolCalls(message.tool_calls);
      const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

      return {
        status: hasToolCalls ? "tool_calls" : "ok",
        content: message.content || "",
        toolCalls,
        metadata: { endpoint, model: response.data?.model || model, mode: "openrouter", usage: response.data?.usage || null },
      };
    },
  };
}

module.exports = { createOpenRouterProvider };

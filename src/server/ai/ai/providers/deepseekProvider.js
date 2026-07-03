"use strict";

const { apiFetch, buildSystemMessage, parseToolCalls } = require("./providerUtils");

function createDeepSeekProvider(config) {
  const apiKey = config.deepseekApiKey || process.env.DEEPSEEK_API_KEY || "";
  const model = config.deepseekModel || process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const baseUrl = (config.deepseekBaseUrl || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/+$/, "");

  return {
    name: "deepseek",
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
        return { status: "error", content: `DeepSeek API error: ${response.data?.error?.message || response.status}`, toolCalls: null, metadata: { endpoint, model, mode: "deepseek", statusCode: response.status } };
      }

      const choice = response.data?.choices?.[0] || {};
      const message = choice.message || {};
      const toolCalls = parseToolCalls(message.tool_calls);
      const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

      return {
        status: hasToolCalls ? "tool_calls" : "ok",
        content: message.content || "",
        toolCalls,
        metadata: { endpoint, model: response.data?.model || model, mode: "deepseek", usage: response.data?.usage || null },
      };
    },
  };
}

module.exports = { createDeepSeekProvider };

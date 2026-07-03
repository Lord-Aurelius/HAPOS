"use strict";

const { apiFetch, buildSystemMessage, parseToolCalls } = require("./providerUtils");

function createGroqProvider(config) {
  const apiKey = config.groqApiKey || process.env.GROQ_API_KEY || "";
  const model = config.groqModel || process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const baseUrl = (config.groqBaseUrl || process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");

  return {
    name: "groq",
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
        return { status: "error", content: `Groq API error: ${response.data?.error?.message || response.status}`, toolCalls: null, metadata: { endpoint, model, mode: "groq", statusCode: response.status } };
      }

      const choice = response.data?.choices?.[0] || {};
      const message = choice.message || {};
      const toolCalls = parseToolCalls(message.tool_calls);
      const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

      return {
        status: hasToolCalls ? "tool_calls" : "ok",
        content: message.content || "",
        toolCalls,
        metadata: { endpoint, model: response.data?.model || model, mode: "groq", usage: response.data?.usage || null },
      };
    },
  };
}

module.exports = { createGroqProvider };

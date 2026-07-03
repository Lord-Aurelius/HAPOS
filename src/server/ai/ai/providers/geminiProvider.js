"use strict";

const { apiFetch, buildSystemMessage, parseToolCalls } = require("./providerUtils");

function createGeminiProvider(config) {
  const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY || "";
  const model = config.geminiModel || process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const baseUrl = (config.geminiBaseUrl || process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");

  return {
    name: "gemini",
    model,
    async invoke(request) {
      const endpoint = request.endpoint || "chat";
      const entityContext = request.entityContext || [];
      const tools = request.tools || [];
      const plannerMessage = request.plannerMessage || null;
      const messages = request.messages || [];

      const systemMsg = buildSystemMessage(endpoint, entityContext, plannerMessage);

      const geminiContents = [];
      if (systemMsg) {
        geminiContents.push({ role: "user", parts: [{ text: systemMsg.content }] });
        geminiContents.push({ role: "model", parts: [{ text: "Understood. I will follow these instructions." }] });
      }
      for (const msg of messages) {
        const role = msg.role === "assistant" ? "model" : msg.role === "system" ? "user" : msg.role;
        geminiContents.push({ role, parts: [{ text: msg.content || "" }] });
      }

      const body = { contents: geminiContents };
      if (request.payload?.options) Object.assign(body, request.payload.options);

      const path = `/models/${model}:generateContent?key=${apiKey}`;
      const response = await apiFetch(baseUrl, path, body, null);

      if (response.status >= 400) {
        return { status: "error", content: `Gemini API error: ${response.data?.error?.message || response.status}`, toolCalls: null, metadata: { endpoint, model, mode: "gemini", statusCode: response.status } };
      }

      const candidate = response.data?.candidates?.[0] || {};
      const content = candidate.content?.parts?.map((p) => p.text).join("") || "";
      return { status: "ok", content, toolCalls: null, metadata: { endpoint, model, mode: "gemini" } };
    },
  };
}

module.exports = { createGeminiProvider };

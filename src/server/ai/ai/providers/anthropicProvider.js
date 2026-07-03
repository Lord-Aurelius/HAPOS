"use strict";

const { apiFetch, buildSystemMessage, parseToolCalls } = require("./providerUtils");

function createAnthropicProvider(config) {
  const apiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY || "";
  const model = config.anthropicModel || process.env.ANTHROPIC_MODEL || "claude-3-haiku-20240307";
  const baseUrl = (config.anthropicBaseUrl || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1").replace(/\/+$/, "");

  return {
    name: "anthropic",
    model,
    async invoke(request) {
      const endpoint = request.endpoint || "chat";
      const entityContext = request.entityContext || [];
      const tools = request.tools || [];
      const plannerMessage = request.plannerMessage || null;
      const messages = request.messages || [];

      const systemMsg = buildSystemMessage(endpoint, entityContext, plannerMessage);
      const filteredMessages = messages.filter((m) => m.role !== "system");

      const body = {
        model,
        max_tokens: 4096,
        messages: filteredMessages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content || "" })),
      };

      if (systemMsg) body.system = systemMsg.content;
      if (tools.length > 0) body.tools = tools.map((t) => ({ name: t.function?.name || t.name, description: t.function?.description || "", input_schema: t.function?.parameters || { type: "object", properties: {} } }));
      if (request.payload?.options) Object.assign(body, request.payload.options);

      const headers = { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
      const response = await apiFetchWithHeaders(baseUrl, "/messages", body, headers);

      if (response.status >= 400) {
        return { status: "error", content: `Anthropic API error: ${response.data?.error?.message || response.status}`, toolCalls: null, metadata: { endpoint, model, mode: "anthropic", statusCode: response.status } };
      }

      const content = response.data?.content?.[0]?.text || "";
      return { status: "ok", content, toolCalls: null, metadata: { endpoint, model: response.data?.model || model, mode: "anthropic", usage: response.data?.usage || null } };
    },
  };
}

function apiFetchWithHeaders(baseUrl, path, body, headers) {
  const https = require("https");
  const http = require("http");
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const postData = JSON.stringify(body);
    const isHttps = url.protocol === "https:";
    const transport = isHttps ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + (url.search || ""),
      method: "POST",
      headers: { ...headers, "Content-Length": Buffer.byteLength(postData) },
      timeout: 120000,
    };
    const req = transport.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: { content: raw } }); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("API request timed out")); });
    req.write(postData);
    req.end();
  });
}

module.exports = { createAnthropicProvider };

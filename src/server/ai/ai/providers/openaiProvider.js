"use strict";

const https = require("https");
const http = require("http");
const { toolSchemasForProvider } = require("../toolSchemas");
const { buildSystemMessage } = require("./providerUtils");

function createOpenAIProvider(config) {
  const apiKey = config.openaiApiKey || process.env.OPENAI_API_KEY || "";
  const model = config.openaiModel || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const baseUrl = (config.openaiBaseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");

  return {
    name: "openai",
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

      const body = {
        model,
        messages: finalMessages,
        stream: false,
      };

      if (tools.length > 0) {
        body.tools = tools;
        body.tool_choice = "auto";
      }

      if (request.payload?.options) {
        Object.assign(body, request.payload.options);
      }

      const response = await apiFetch(baseUrl, "/chat/completions", body, apiKey);

      if (response.status >= 400) {
        return {
          status: "error",
          content: `OpenAI API error: ${response.data?.error?.message || response.status}`,
          toolCalls: null,
          metadata: { endpoint, model, mode: "openai", statusCode: response.status },
        };
      }

      const choice = response.data?.choices?.[0] || {};
      const message = choice.message || {};
      const content = message.content || "";
      const rawToolCalls = message.tool_calls;
      const toolCalls = Array.isArray(rawToolCalls) && rawToolCalls.length > 0
        ? rawToolCalls.map((tc) => ({
            id: tc.id || `toolcall_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: tc.type || "function",
            function: {
              name: tc.function?.name || "",
              arguments: typeof tc.function?.arguments === "string"
                ? tc.function.arguments
                : JSON.stringify(tc.function?.arguments || {}),
            },
          }))
        : null;

      const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;
      return {
        status: hasToolCalls ? "tool_calls" : "ok",
        content,
        toolCalls,
        metadata: {
          endpoint,
          model: response.data?.model || model,
          mode: "openai",
          usage: response.data?.usage || null,
        },
      };
    },
  };
}

function apiFetch(baseUrl, path, body, apiKey) {
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
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(postData),
      },
      timeout: 120000,
    };
    const req = transport.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, data: { content: raw } });
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("API request timed out")); });
    req.write(postData);
    req.end();
  });
}

module.exports = { createOpenAIProvider };

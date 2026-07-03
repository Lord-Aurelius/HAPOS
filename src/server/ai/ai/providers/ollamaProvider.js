"use strict";

const https = require("https");
const http = require("http");
const { buildSystemMessage, buildDefaultMessages } = require("./providerUtils");

function createOllamaProvider(config) {
  const baseUrl = String(config.ollamaBaseUrl || process.env.AI_OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
  const model = String(config.ollamaModel || process.env.AI_OLLAMA_MODEL || "gemma4:31b").replace(/\/+$/, "");
  const keepAlive = String(config.ollamaKeepAlive || process.env.OLLAMA_KEEP_ALIVE || "5m");

  return {
    name: "ollama",
    model,
    async invoke(request) {
      const endpoint = request.endpoint || "chat";
      const ctx = request.context || {};
      const payload = request.payload || {};

      const entityContext = request.entityContext || [];
      const tools = request.tools || [];
      const plannerMessage = request.plannerMessage || null;

      const messages = request.messages || buildDefaultMessages(endpoint, payload);

      const systemMsg = buildSystemMessage(endpoint, entityContext, plannerMessage);
      const hasSystem = messages.length > 0 && messages[0].role === "system";
      const finalMessages = hasSystem
        ? [systemMsg, ...messages.slice(1)]
        : [systemMsg, ...messages];

      const body = {
        model,
        messages: finalMessages,
        stream: false,
        keep_alive: keepAlive,
      };

      if (tools.length > 0) {
        body.tools = tools;
      }

      if (payload.options) {
        Object.assign(body, payload.options);
      }

      const response = await ollamaFetch(baseUrl, "/api/chat", body);

      if (response.status >= 400) {
        return {
          status: "error",
          content: `Ollama API error: ${response.data.error || response.status}`,
          toolCalls: null,
          metadata: { endpoint, model, mode: "ollama", statusCode: response.status }
        };
      }

      const message = response.data.message || {};
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
            }
          }))
        : null;

      const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

      return {
        status: hasToolCalls ? "tool_calls" : "ok",
        content,
        toolCalls,
        metadata: {
          endpoint,
          model: response.data.model || model,
          mode: "ollama",
          done: Boolean(response.data.done)
        }
      };
    }
  };
}

function ollamaFetch(baseUrl, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const postData = JSON.stringify(body);
    const isHttps = url.protocol === "https:";
    const transport = isHttps ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData)
      },
      timeout: 60000
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
    req.on("timeout", () => { req.destroy(); reject(new Error("Ollama request timed out")); });
    req.write(postData);
    req.end();
  });
}

module.exports = { createOllamaProvider };

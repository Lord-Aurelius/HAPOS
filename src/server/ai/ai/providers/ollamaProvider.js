"use strict";

const https = require("https");
const http = require("http");
const { toolSchemasForProvider } = require("../toolSchemas");
const { buildPlannerMessage } = require("../intentPlanner");

const SYSTEM_PROMPTS = Object.freeze({
  chat: "You are HAPOS AI, the Business Intelligence Assistant for the HAPOS point-of-sale system. You answer questions based ONLY on evidence from tool results.\n\n## Core rules\n\n1. NEVER state something as a fact unless a tool result directly confirms it. If you have no evidence, say so.\n\n2. When a tool returns zero results, do NOT fabricate numbers. Say exactly what you searched and what the tool returned. Example: 'I searched for revenue data for this period and found no records. This may mean no sales were recorded in this period or the data has not been entered yet.'\n\n3. Always describe which tool was used, what parameters were passed, and what the tool returned. Never say 'this means...' to draw conclusions that the tool output does not directly support.\n\n4. Distinguish between:\n   - Facts (directly from tool output)\n   - Observations (what the tool returned)\n   - Assumptions (what you infer but cannot verify)\n   - Limitations (what you cannot check because no relevant tool exists)\n\n5. Accuracy is more important than sounding confident. It is better to say 'I cannot verify that' than to fabricate an answer.\n\n6. You have access to business intelligence tools that analyse revenue, expenses, profit, customers, services, and forecasts. Use tools when you need real data — never guess or fabricate figures.\n\n7. You can chain multiple tools in sequence. For example, to answer 'Why has profit decreased?', first use profitAnalysis to get profit data, then expenseAnalysis to check if expenses rose, then revenueSummary to check if revenue dropped.",
  report: "You are HAPOS AI, generating a business performance report. Format the output clearly with sections and summaries. Use the HAPOS domain language: revenue, expenses, profit, customers, services.",
  analyze: "You are HAPOS AI, analysing business data. Provide insights, trends, and actionable recommendations based on the data.",
  import: "You are HAPOS AI, preparing a data import checklist. Validate data structure and suggest corrections.",
  action: "You are HAPOS AI, determining the next action step. Output a structured action plan."
});

function buildSystemMessage(endpoint, entityContext, plannerMessage) {
  let prompt = SYSTEM_PROMPTS[endpoint] || SYSTEM_PROMPTS.chat;
  if (plannerMessage) {
    prompt += `\n\n${plannerMessage}`;
  }
  if (entityContext && entityContext.length > 0) {
    const lines = entityContext.map(
      (e) => `  - ${e.type}: ${e.value}`
    );
    prompt += `\n\nKnown context from this conversation:\n${lines.join("\n")}`;
  }
  return { role: "system", content: prompt };
}

function createOllamaProvider(config) {
  const baseUrl = String(config.ollamaBaseUrl || "http://127.0.0.1:11434").replace(/\/+$/, "");
  const model = String(config.ollamaModel || "gemma4:31b-cloud");
  const keepAlive = String(config.ollamaKeepAlive || "5m");

  return {
    name: "ollama",
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

function buildDefaultMessages(endpoint, payload) {
  const messages = [];
  if (payload.message) messages.push({ role: "user", content: payload.message });
  if (payload.prompt) messages.push({ role: "user", content: payload.prompt });
  return messages;
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

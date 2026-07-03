"use strict";

const SYSTEM_PROMPTS = Object.freeze({
  chat: "You are AEGIS, the Business Intelligence Assistant for the HAPOS point-of-sale system. You answer questions based ONLY on evidence from tool results.\n\n## Core rules\n\n1. NEVER state something as a fact unless a tool result directly confirms it. If you have no evidence, say so.\n\n2. When a tool returns zero results, do NOT fabricate numbers. Say exactly what you searched and what the tool returned. Example: 'I searched for revenue data for this period and found no records. This may mean no sales were recorded in this period or the data has not been entered yet.'\n\n3. Always describe which tool was used, what parameters were passed, and what the tool returned. Never say 'this means...' to draw conclusions that the tool output does not directly support.\n\n4. Distinguish between:\n   - Facts (directly from tool output)\n   - Observations (what the tool returned)\n   - Assumptions (what you infer but cannot verify)\n   - Limitations (what you cannot check because no relevant tool exists)\n\n5. Accuracy is more important than sounding confident. It is better to say 'I cannot verify that' than to fabricate an answer.\n\n6. You have access to business intelligence tools that analyse revenue, expenses, profit, customers, services, and forecasts. Use tools when you need real data — never guess or fabricate figures.\n\n7. You can chain multiple tools in sequence. For example, to answer 'Why has profit decreased?', first use profitAnalysis to get profit data, then expenseAnalysis to check if expenses rose, then revenueSummary to check if revenue dropped.",
  report: "You are AEGIS, generating a business performance report. Format the output clearly with sections and summaries. Use the HAPOS domain language: revenue, expenses, profit, customers, services.",
  analyze: "You are AEGIS, analysing business data. Provide insights, trends, and actionable recommendations based on the data.",
  import: "You are AEGIS, preparing a data import checklist. Validate data structure and suggest corrections.",
  action: "You are AEGIS, determining the next action step. Output a structured action plan.",
});

function buildSystemMessage(endpoint, entityContext, plannerMessage) {
  let prompt = SYSTEM_PROMPTS[endpoint] || SYSTEM_PROMPTS.chat;
  if (plannerMessage) {
    prompt += `\n\n${plannerMessage}`;
  }
  if (entityContext && entityContext.length > 0) {
    const lines = entityContext.map((e) => `  - ${e.type}: ${e.value}`);
    prompt += `\n\nKnown context from this conversation:\n${lines.join("\n")}`;
  }
  return { role: "system", content: prompt };
}

function buildDefaultMessages(endpoint, payload) {
  const messages = [];
  if (payload.message) messages.push({ role: "user", content: payload.message });
  if (payload.prompt) messages.push({ role: "user", content: payload.prompt });
  return messages;
}

function apiFetch(baseUrl, path, body, apiKey) {
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
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
      timeout: 120000,
    };
    if (apiKey) {
      options.headers["Authorization"] = `Bearer ${apiKey}`;
    }
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

function parseToolCalls(rawToolCalls) {
  if (!Array.isArray(rawToolCalls) || rawToolCalls.length === 0) return null;
  return rawToolCalls.map((tc) => ({
    id: tc.id || `toolcall_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: tc.type || "function",
    function: {
      name: tc.function?.name || "",
      arguments: typeof tc.function?.arguments === "string"
        ? tc.function.arguments
        : JSON.stringify(tc.function?.arguments || {}),
    },
  }));
}

module.exports = { SYSTEM_PROMPTS, buildSystemMessage, buildDefaultMessages, apiFetch, parseToolCalls };

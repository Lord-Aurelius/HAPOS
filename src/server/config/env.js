"use strict";

const ENV = process.env;

const ai = Object.freeze({
  enabled: ENV.AI_ENABLED === "true",
  defaultProvider: (ENV.AI_DEFAULT_PROVIDER || "disabled").toLowerCase().trim(),
  allowedProviders: ENV.AI_ALLOWED_PROVIDERS
    ? ENV.AI_ALLOWED_PROVIDERS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [],
  openaiApiKey: ENV.AI_OPENAI_API_KEY || "",
  openaiModel: ENV.AI_OPENAI_MODEL || "gpt-4o-mini",
  openaiBaseUrl: ENV.AI_OPENAI_BASE_URL || "https://api.openai.com/v1",
  deepseekApiKey: ENV.AI_DEEPSEEK_API_KEY || "",
  deepseekModel: ENV.AI_DEEPSEEK_MODEL || "deepseek-chat",
  deepseekBaseUrl: ENV.AI_DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
  openrouterApiKey: ENV.AI_OPENROUTER_API_KEY || "",
  openrouterModel: ENV.AI_OPENROUTER_MODEL || "openai/gpt-4o-mini",
  openrouterBaseUrl: ENV.AI_OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
  geminiApiKey: ENV.AI_GEMINI_API_KEY || "",
  geminiModel: ENV.AI_GEMINI_MODEL || "gemini-1.5-flash",
  geminiBaseUrl: ENV.AI_GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta",
  anthropicApiKey: ENV.AI_ANTHROPIC_API_KEY || "",
  anthropicModel: ENV.AI_ANTHROPIC_MODEL || "claude-3-haiku-20240307",
  anthropicBaseUrl: ENV.AI_ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1",
  groqApiKey: ENV.AI_GROQ_API_KEY || "",
  groqModel: ENV.AI_GROQ_MODEL || "llama-3.3-70b-versatile",
  groqBaseUrl: ENV.AI_GROQ_BASE_URL || "https://api.groq.com/openai/v1",
  ollamaBaseUrl: (ENV.AI_OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, ""),
  ollamaModel: ENV.AI_OLLAMA_MODEL || "gemma4:31b",
  ollamaKeepAlive: ENV.AI_OLLAMA_KEEP_ALIVE || "5m",
});

module.exports = { ai };

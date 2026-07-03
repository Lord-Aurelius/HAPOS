"use strict";

const ENV = process.env;

const ai = Object.freeze({
  enabled: ENV.AI_ENABLED === "true",
  defaultProvider: ENV.AI_DEFAULT_PROVIDER || "disabled",
  allowedProviders: ENV.AI_ALLOWED_PROVIDERS
    ? ENV.AI_ALLOWED_PROVIDERS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [],
  openaiApiKey: ENV.OPENAI_API_KEY || "",
  openaiModel: ENV.OPENAI_MODEL || "gpt-4o-mini",
  openaiBaseUrl: ENV.OPENAI_BASE_URL || "https://api.openai.com/v1",
  deepseekApiKey: ENV.DEEPSEEK_API_KEY || "",
  deepseekModel: ENV.DEEPSEEK_MODEL || "deepseek-chat",
  deepseekBaseUrl: ENV.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
  openrouterApiKey: ENV.OPENROUTER_API_KEY || "",
  openrouterModel: ENV.OPENROUTER_MODEL || "openai/gpt-4o-mini",
  openrouterBaseUrl: ENV.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
  geminiApiKey: ENV.GEMINI_API_KEY || "",
  geminiModel: ENV.GEMINI_MODEL || "gemini-1.5-flash",
  geminiBaseUrl: ENV.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta",
  anthropicApiKey: ENV.ANTHROPIC_API_KEY || "",
  anthropicModel: ENV.ANTHROPIC_MODEL || "claude-3-haiku-20240307",
  anthropicBaseUrl: ENV.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1",
  groqApiKey: ENV.GROQ_API_KEY || "",
  groqModel: ENV.GROQ_MODEL || "llama-3.3-70b-versatile",
  groqBaseUrl: ENV.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
  ollamaBaseUrl: ENV.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
  ollamaModel: ENV.OLLAMA_MODEL || "gemma4:31b-cloud",
  ollamaKeepAlive: ENV.OLLAMA_KEEP_ALIVE || "5m",
});

module.exports = { ai };

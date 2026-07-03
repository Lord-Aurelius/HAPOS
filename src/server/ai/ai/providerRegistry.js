"use strict";

const env = require("../../config/env");
const { badRequest } = require("../../utils/httpError");
const { createDisabledProvider } = require("./providers/disabledProvider");
const { createOllamaProvider } = require("./providers/ollamaProvider");
const { createOpenAIProvider } = require("./providers/openaiProvider");
const { createDeepSeekProvider } = require("./providers/deepseekProvider");
const { createOpenRouterProvider } = require("./providers/openrouterProvider");
const { createGeminiProvider } = require("./providers/geminiProvider");
const { createAnthropicProvider } = require("./providers/anthropicProvider");
const { createGroqProvider } = require("./providers/groqProvider");

const SUPPORTED_PROVIDERS = Object.freeze([
  "disabled",
  "openai",
  "deepseek",
  "openrouter",
  "gemini",
  "anthropic",
  "groq",
  "ollama",
]);

const PROVIDER_FACTORIES = Object.freeze({
  openai: createOpenAIProvider,
  deepseek: createDeepSeekProvider,
  openrouter: createOpenRouterProvider,
  gemini: createGeminiProvider,
  anthropic: createAnthropicProvider,
  groq: createGroqProvider,
  ollama: createOllamaProvider,
});

function normalizeProviderName(value) {
  return String(value || "disabled").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function allowedProviders(config = env.ai) {
  const configured = Array.isArray(config.allowedProviders) && config.allowedProviders.length
    ? config.allowedProviders
    : SUPPORTED_PROVIDERS.filter((p) => p === "disabled" || getProviderApiKey(p, config));
  return configured
    .map(normalizeProviderName)
    .filter((name) => SUPPORTED_PROVIDERS.includes(name));
}

function getProviderApiKey(providerName, config) {
  const keyMap = {
    openai: config.openaiApiKey,
    deepseek: config.deepseekApiKey,
    openrouter: config.openrouterApiKey,
    gemini: config.geminiApiKey,
    anthropic: config.anthropicApiKey,
    groq: config.groqApiKey,
    ollama: "builtin",
  };
  return keyMap[providerName] || "";
}

function resolveProvider(options = {}) {
  const config = options.config || env.ai || {};
  const enabled = Boolean(config.enabled);
  const requestedProvider = normalizeProviderName(options.provider || config.defaultProvider);
  const providerName = enabled ? requestedProvider : "disabled";

  if (providerName === "disabled") {
    return createDisabledProvider();
  }

  if (!SUPPORTED_PROVIDERS.includes(providerName)) {
    throw badRequest(`AI provider '${providerName}' is not supported. Supported: ${SUPPORTED_PROVIDERS.join(", ")}`);
  }

  const apiKey = getProviderApiKey(providerName, config);
  if (!apiKey) {
    throw badRequest(`AI provider '${providerName}' is not configured. Set the API key in environment variables.`);
  }

  const factory = PROVIDER_FACTORIES[providerName];
  if (factory) {
    return factory(config);
  }

  throw badRequest(`AI provider '${providerName}' has no implementation factory.`);
}

function listConfiguredProviders(config = env.ai) {
  return SUPPORTED_PROVIDERS.filter((p) => p === "disabled" || getProviderApiKey(p, config)).map((name) => ({
    name,
    configured: name === "disabled" || Boolean(getProviderApiKey(name, config)),
    active: name === (config.defaultProvider || "disabled"),
  }));
}

module.exports = {
  SUPPORTED_PROVIDERS,
  PROVIDER_FACTORIES,
  allowedProviders,
  resolveProvider,
  listConfiguredProviders,
};

const env = require("../../config/env");
const { badRequest } = require("../../utils/httpError");
const { createDisabledProvider } = require("./providers/disabledProvider");
const { createPlaceholderProvider } = require("./providers/placeholderProvider");
const { createOllamaProvider } = require("./providers/ollamaProvider");

const SUPPORTED_PROVIDERS = Object.freeze([
  "disabled",
  "gemini",
  "openai",
  "claude",
  "gemma",
  "ollama",
  "qwen",
  "custom"
]);

const PROVIDER_FACTORIES = Object.freeze({
  ollama: createOllamaProvider
});

function normalizeProviderName(value) {
  return String(value || "disabled").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function allowedProviders(config = env.ai) {
  const configured = Array.isArray(config.allowedProviders) && config.allowedProviders.length
    ? config.allowedProviders
    : SUPPORTED_PROVIDERS;
  return configured
    .map(normalizeProviderName)
    .filter((name) => SUPPORTED_PROVIDERS.includes(name));
}

function resolveProvider(options = {}) {
  const config = options.config || env.ai || {};
  const enabled = Boolean(config.enabled);
  const requestedProvider = normalizeProviderName(options.provider || config.defaultProvider);
  const providerName = enabled ? requestedProvider : "disabled";
  const allowed = allowedProviders(config);

  if (!SUPPORTED_PROVIDERS.includes(providerName) || !allowed.includes(providerName)) {
    throw badRequest(`AI provider '${providerName}' is not allowed.`);
  }

  if (providerName === "disabled") {
    return createDisabledProvider();
  }

  const factory = PROVIDER_FACTORIES[providerName];
  if (factory) {
    return factory(config);
  }

  return createPlaceholderProvider(providerName);
}

module.exports = {
  SUPPORTED_PROVIDERS,
  PROVIDER_FACTORIES,
  allowedProviders,
  resolveProvider
};

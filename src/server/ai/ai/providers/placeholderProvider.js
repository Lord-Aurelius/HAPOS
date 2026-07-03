function createPlaceholderProvider(providerName) {
  return {
    name: providerName,
    async invoke(request) {
      return {
        status: "not_configured",
        content: `${providerName} support is prepared, but provider integration is not enabled yet.`,
        metadata: {
          endpoint: request.endpoint,
          mode: "provider-shell"
        }
      };
    }
  };
}

module.exports = {
  createPlaceholderProvider
};

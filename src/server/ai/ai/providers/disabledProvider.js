function createDisabledProvider() {
  return {
    name: "disabled",
    async invoke(request) {
      return {
        status: "disabled",
        content: "AI is ready in HAPOS, but no AI provider is enabled yet.",
        metadata: {
          endpoint: request.endpoint,
          mode: "placeholder"
        }
      };
    }
  };
}

module.exports = {
  createDisabledProvider
};

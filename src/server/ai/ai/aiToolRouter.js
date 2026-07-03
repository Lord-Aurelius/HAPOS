const { executeTool, prepareToolExecution, registryHealth } = require("./toolRegistry");
const { toolSchemasForProvider } = require("./toolSchemas");

async function executeToolCall(authContext, toolCall) {
  const context = {
    tenantId: authContext.tenantId,
    userId: authContext.userId,
    role: authContext.role
  };
  const toolId = toolCall.toolId || toolCall.tool;
  const args = toolCall.args || toolCall.arguments || {};

  if (!toolId) {
    return { success: false, error: "No toolId specified" };
  }

  const plan = prepareToolExecution({
    role: context.role,
    toolId,
    context,
    args
  });

  if (plan.requiresConfirmation) {
    return {
      success: false,
      requiresConfirmation: true,
      toolId,
      args,
      message: `Tool "${toolId}" requires human confirmation before execution.`
    };
  }

  try {
    const result = await executeTool({ role: context.role, toolId, context, args });
    return { success: true, toolId, result };
  } catch (error) {
    return { success: false, toolId, error: error.message };
  }
}

async function executeToolBatch(authContext, toolCalls) {
  const results = [];
  for (const call of (toolCalls || [])) {
    results.push(await executeToolCall(authContext, call));
  }
  return results;
}

function getToolHealth() {
  return registryHealth();
}

function getToolSchemas() {
  return toolSchemasForProvider();
}

module.exports = { executeToolCall, executeToolBatch, getToolHealth, getToolSchemas };

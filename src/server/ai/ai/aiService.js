"use strict";

const auditServiceDefault = require("./aiAuditService");
const { buildAiRequestContext } = require("./aiPermissions");
const providerRegistryDefault = require("./providerRegistry");
const { toolSchemasForProvider } = require("./toolSchemas");
const { buildPlannerMessage } = require("./intentPlanner");
const { mergeToolResults } = require("./evidenceMerger");
const { generateInsights } = require("./insightEngine");
const {
  executeTool,
  prepareToolExecution,
} = require("./toolRegistry");
const memoryStore = require("./memoryStore");

const FUTURE_CAPABILITIES = Object.freeze([
  "excel_imports",
  "file_uploads",
  "smart_device_control",
  "workflow_automation",
]);

const MAX_AGENT_STEPS = 10;

function outputMetadata(providerResult = {}) {
  return {
    status: providerResult.status || "unknown",
    hasContent: Boolean(providerResult.content),
    mode: providerResult.metadata ? providerResult.metadata.mode || null : null,
    steps: providerResult.steps || 0,
  };
}

async function handleAiRequest(authContext, endpoint, payload = {}, deps = {}) {
  const auditService = deps.auditService || auditServiceDefault;
  const providerRegistry = deps.providerRegistry || providerRegistryDefault;
  const context = buildAiRequestContext(authContext, payload, endpoint);
  const provider = providerRegistry.resolveProvider({
    provider: payload.provider || null,
  });

  const conversationId = payload.conversationId || "default";
  const userId = context.userId;
  const tenantId = context.tenantId;

  if (provider.name === "disabled") {
    const result = await provider.invoke({ endpoint: context.endpoint, context, payload });
    if (payload.message) {
      memoryStore.addMessage(tenantId, userId, "user", payload.message, conversationId);
    }
    return buildResponse(endpoint, provider, result, context);
  }

  const maxSteps = payload.maxSteps || MAX_AGENT_STEPS;

  const history = memoryStore.getConversation(tenantId, userId, conversationId);
  const entityContext = memoryStore.getEntities(tenantId, userId, conversationId);
  const storedReportingContext = memoryStore.getReportingContext(tenantId, userId, conversationId);

  const messages = history.map((m) => ({ role: m.role, content: m.content }));
  if (payload.message) {
    memoryStore.addMessage(tenantId, userId, "user", payload.message, conversationId);
    messages.push({ role: "user", content: payload.message });
  }

  const tools = toolSchemasForProvider();

  const plannerMessage = payload.message
    ? buildPlannerMessage(payload.message)
    : null;

  let reportingContextMessage = null;
  if (storedReportingContext) {
    const rc = storedReportingContext;
    reportingContextMessage = {
      role: "system",
      content: `[PERSISTED REPORTING CONTEXT FROM PREVIOUS ANALYSIS]
Period: ${rc.period || "N/A"}
Reporting Mode: ${rc.reportingMode || "CURRENT_OPERATIONAL"}
Confidence: ${rc.confidence || "MEDIUM"}

Use this as the authoritative answer if the user asks about which period or time frame their data is based on. Do NOT say "I don't know" — this metadata was collected from prior tool execution.`,
    };
    messages.unshift(reportingContextMessage);
  }

  let allToolResults = [];
  let agentSteps = 0;
  let finalContent = "";
  let finalStatus = "ok";
  let finalToolCalls = null;
  let lastProviderResult = null;

  while (agentSteps < maxSteps) {
    agentSteps++;

    lastProviderResult = await provider.invoke({
      endpoint: context.endpoint,
      context,
      payload,
      futureCapabilities: FUTURE_CAPABILITIES,
      messages,
      tools,
      entityContext,
      plannerMessage,
    });

    const content = lastProviderResult.content || "";
    const toolCalls = lastProviderResult.toolCalls;

    if (!toolCalls || toolCalls.length === 0) {
      finalContent = content;
      finalStatus = lastProviderResult.status || "ok";
      messages.push({ role: "assistant", content: finalContent });
      break;
    }

    finalStatus = "tool_calls";
    if (content) {
      messages.push({ role: "assistant", content });
    }

    for (const tc of toolCalls) {
      const fnName = tc.function?.name;
      let fnArgs = {};
      try {
        fnArgs = JSON.parse(tc.function?.arguments || "{}");
      } catch {
        fnArgs = {};
      }

      const toolResult = await executeSingleToolCall(
        authContext, context, fnName, fnArgs, auditService
      );

      const toolResultContent = typeof toolResult === "string"
        ? toolResult
        : JSON.stringify(toolResult);
      messages.push({
        role: "user",
        content: `[Tool result from ${fnName}]: ${toolResultContent}`,
      });
      allToolResults.push({ toolId: fnName, args: fnArgs, result: toolResult });

      const detected = memoryStore.extractEntitiesFromContent(JSON.stringify(toolResult));
      for (const e of detected) {
        memoryStore.addEntity(tenantId, userId, e.type, e.value, conversationId);
      }
    }

    if (agentSteps >= maxSteps) {
      finalContent = "I've completed all available reasoning steps. Here's a summary of what I found.";
      finalStatus = "max_steps_reached";
      messages.push({ role: "assistant", content: finalContent });
    }
  }

  let assistantContent = finalContent || lastProviderResult?.content || "";

  if (allToolResults.length > 0) {
    const evidence = mergeToolResults(allToolResults);
    const insights = generateInsights(evidence);

    const evidenceJson = JSON.stringify(evidence, null, 2);
    const insightsJson = JSON.stringify(insights, null, 2);

    const rm = evidence.reportingMetadata;
    const reportingContextStr = rm
      ? `Period: ${rm.period || "N/A"}
Reporting Mode: ${rm.reportingMode || "CURRENT_OPERATIONAL"}
Confidence: ${rm.confidence || "MEDIUM"}`
      : "Reporting mode: CURRENT_OPERATIONAL (default) - no reporting metadata available from tool results.";

    const formatPrompt = `[EVIDENCE SUMMARY]
${evidenceJson}

[REPORTING CONTEXT]
${reportingContextStr}

IMPORTANT REPORTING CONTEXT RULE:
If the user asks "which period is this based on?" or any question about time period, answer DIRECTLY from the REPORTING CONTEXT above. Do NOT say "I don't know" or "the tool does not return" — the metadata above IS the authoritative answer.

[INSIGHTS]
${insightsJson}

Based on the evidence and insights above, generate a well-structured response to the user's original question.

Use this structure when the query is about business performance:

1. **Executive Summary** — Start with a concise 2-3 sentence overview of the most important findings.
2. **Revenue** — Revenue figures, trends, and comparisons.
3. **Expenses** — Spending analysis and notable patterns.
4. **Profitability** — Gross and net profit, margins, and changes.
5. **Customers** — Customer activity, retention, and top spenders.
6. **Services** — Service performance, top performers, and demand.
7. **Forecast** — Future projections if applicable.
8. **Risks & Opportunities** — Notable risks and growth opportunities.
9. **Recommendations** — Actionable recommendations based on the data.
10. **Missing Information** — Clearly state what information could not be retrieved and why (feature unavailable, no data exists, permission issue, or tool error). Do not fabricate reasons.

When the query is about a general topic (listing services, customer info, etc.), use a simpler structure appropriate to the question but always include observations and note any missing information.`;

    messages.push({ role: "user", content: formatPrompt });

    const formatResult = await provider.invoke({
      endpoint: context.endpoint,
      context,
      payload,
      futureCapabilities: FUTURE_CAPABILITIES,
      messages,
      tools: [],
      entityContext,
    });

    if (formatResult.content) {
      assistantContent = formatResult.content;
    }
  }

  assistantContent = validateAssistantResponse(assistantContent, allToolResults, history);
  if (assistantContent) {
    memoryStore.addMessage(tenantId, userId, "assistant", assistantContent, conversationId);
  }

  if (allToolResults.length > 0) {
    const bestMeta = _findBestReportingMetadata(allToolResults);
    if (bestMeta) {
      memoryStore.setReportingContext(tenantId, userId, conversationId, bestMeta);
    }
  }

  const startMetadata = {
    conversationId,
    steps: agentSteps,
    toolCallsExecuted: allToolResults.length,
    toolResults: allToolResults,
  };

  const reportingAudit = auditService.reportingContextSummary
    ? auditService.reportingContextSummary(allToolResults)
    : {};

  await auditService.logAiRequest(authContext, {
    userId: context.userId,
    tenantId: context.tenantId,
    role: context.role,
    endpoint: context.endpoint,
    provider: provider.name,
    status: finalStatus,
    permissions: context.permissions,
    inputMetadata: auditService.metadataSummary
      ? auditService.metadataSummary(payload)
      : {},
    outputMetadata: {
      ...outputMetadata({ status: finalStatus, metadata: { mode: "ollama" }, steps: agentSteps }),
      ...startMetadata,
      ...reportingAudit,
    },
  });

  return buildResponse(endpoint, provider, {
    status: finalStatus,
    content: assistantContent,
    metadata: { mode: "ollama", conversationId, steps: agentSteps, toolCallsExecuted: allToolResults.length },
  }, context);
}

async function executeSingleToolCall(authContext, context, toolId, args, auditService) {
  try {
    const plan = prepareToolExecution({
      role: context.role,
      toolId,
      context: { tenantId: context.tenantId, userId: context.userId, role: context.role },
      args,
    });

    if (plan.requiresConfirmation) {
      return {
        success: false,
        requiresConfirmation: true,
        message: `Tool "${toolId}" requires human confirmation before execution.`,
      };
    }

    const startTime = Date.now();
    const result = await executeTool({
      role: context.role,
      toolId,
      context: { tenantId: context.tenantId, userId: context.userId, role: context.role },
      args,
    });
    const duration = Date.now() - startTime;

    await auditService.logToolExecution({
      userId: context.userId,
      tenantId: context.tenantId,
      role: context.role,
      toolId,
      args,
      success: true,
      duration,
    });

    return result;
  } catch (error) {
    await auditService.logToolExecution({
      userId: context.userId,
      tenantId: context.tenantId,
      role: context.role,
      toolId,
      args,
      success: false,
      error: error.message,
    });

    return { success: false, error: error.message };
  }
}

function buildResponse(endpoint, provider, providerResult, context) {
  return {
    endpoint,
    provider: provider.name,
    status: providerResult.status || "ok",
    content: providerResult.content || "",
    context: {
      userId: context.userId,
      tenantId: context.tenantId,
      role: context.role,
      permissions: context.permissions,
    },
    futureCapabilities: FUTURE_CAPABILITIES,
    metadata: providerResult.metadata || {},
  };
}

function _findBestReportingMetadata(toolResults) {
  let best = null;
  for (const tr of toolResults) {
    const m = tr.result?.metadata;
    if (m && m.reportingMode) {
      if (!best || (m.confidence === "HIGH" && best.confidence !== "HIGH")) {
        best = {
          period: m.period,
          reportingMode: m.reportingMode,
          confidence: m.confidence,
        };
      }
    }
  }
  return best;
}

function validateAssistantResponse(content, toolResults, history) {
  if (!content) return content;
  var hasHistory = history && history.length > 0;
  var noToolResults = !toolResults || toolResults.length === 0;
  var overconfidentPatterns = [
    /\bthere are no\b/i,
    /\bthere is no\b/i,
    /\bthe system confirms\b/i,
    /\bthis means\b/i,
    /\bthat indicates\b/i,
    /\bwhich proves\b/i,
    /\bconclusively\b/i,
    /\bdefinitely\b/i,
    /\bcertainly\b/i,
    /\bI can confirm\b/i,
    /\bI have verified\b/i,
    /\bas confirmed by\b/i,
  ];
  var hasOverconfident = overconfidentPatterns.some(function(p) { return p.test(content); });
  if (hasOverconfident && noToolResults && !hasHistory && !content.includes("I searched for") && !content.includes("found no")) {
    content = "Note: I don't have direct data to verify this claim. " + content;
  }
  return content;
}

module.exports = {
  FUTURE_CAPABILITIES,
  handleAiRequest,
};

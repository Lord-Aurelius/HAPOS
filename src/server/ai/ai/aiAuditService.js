const { queryOne } = require("../../db/query");

function metadataSummary(payload = {}) {
  return {
    hasMessage: Boolean(payload.message || payload.prompt),
    hasFiles: Array.isArray(payload.files) && payload.files.length > 0,
    fileCount: Array.isArray(payload.files) ? payload.files.length : 0,
    hasWorkflow: Boolean(payload.workflow),
    hasDeviceAction: Boolean(payload.deviceAction),
    contextRefCount: Array.isArray(payload.contextRefs) ? payload.contextRefs.length : 0
  };
}

function reportingContextSummary(toolResults = []) {
  if (!toolResults || toolResults.length === 0) return {};
  const metadataEntries = [];
  for (const tr of toolResults) {
    const m = tr.result?.metadata;
    if (m && m.reportingMode) {
      metadataEntries.push({
        tool: tr.toolId,
        reportingMode: m.reportingMode,
        period: m.period || null,
        confidence: m.confidence || null,
      });
    }
  }
  return { reportingContext: metadataEntries };
}

async function logAiRequest(authContext, entry = {}) {
  try {
    return await queryOne(
      authContext,
      `
      insert into app.ai_audit_logs (
        tenant_id,
        actor_user_id,
        actor_role,
        endpoint,
        provider,
        status,
        permissions,
        input_metadata,
        output_metadata,
        error_code
      )
      values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10)
      returning
        id,
        tenant_id as "tenantId",
        actor_user_id as "actorUserId",
        actor_role as "actorRole",
        endpoint,
        provider,
        status,
        created_at as "createdAt"
      `,
      [
        entry.tenantId || null,
        entry.userId || authContext.userId || null,
        entry.role || authContext.role || null,
        entry.endpoint || "chat",
        entry.provider || "disabled",
        entry.status || "unknown",
        JSON.stringify(entry.permissions || []),
        JSON.stringify(entry.inputMetadata || {}),
        JSON.stringify(entry.outputMetadata || {}),
        entry.errorCode || null
      ]
    );
  } catch (error) {
    if (error && error.code === "42P01") {
      return {
        id: `ai-audit-fallback-${Date.now()}`,
        tenantId: entry.tenantId || null,
        actorUserId: entry.userId || authContext.userId || null,
        actorRole: entry.role || authContext.role || null,
        endpoint: entry.endpoint || "chat",
        provider: entry.provider || "disabled",
        status: entry.status || "unknown",
        createdAt: new Date().toISOString()
      };
    }
    throw error;
  }
}

async function logToolExecution(entry = {}) {
  try {
    return await queryOne(
      { tenantId: entry.tenantId || "system" },
      `
      insert into app.ai_tool_logs (
        tenant_id,
        actor_user_id,
        actor_role,
        tool_id,
        args,
        success,
        duration_ms,
        error_message
      )
      values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
      returning
        id,
        created_at as "createdAt"
      `,
      [
        entry.tenantId || null,
        entry.userId || null,
        entry.role || null,
        entry.toolId || null,
        JSON.stringify(entry.args || {}),
        entry.success !== false,
        entry.duration || null,
        entry.error || null
      ]
    );
  } catch (error) {
    if (error && error.code === "42P01") {
      return { id: null, createdAt: new Date().toISOString() };
    }
    return null;
  }
}

module.exports = {
  logAiRequest,
  logToolExecution,
  metadataSummary,
  reportingContextSummary,
};

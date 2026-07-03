const { badRequest, forbidden } = require("../../utils/httpError");

const ROLE_PERMISSIONS = Object.freeze({
  super_admin: [
    "ai:chat",
    "ai:report",
    "ai:analyze",
    "ai:action",
    "ai:platform:read",
    "ai:tenant:read",
    "ai:workflow:prepare",
  ],
  shop_admin: [
    "ai:chat",
    "ai:report",
    "ai:analyze",
    "ai:action",
    "ai:tenant:read",
    "ai:workflow:prepare",
  ],
  staff: [
    "ai:chat",
    "ai:analyze",
    "ai:tenant:read",
  ],
});

const ENDPOINT_PERMISSION = Object.freeze({
  chat: "ai:chat",
  report: "ai:report",
  analyze: "ai:analyze",
  action: "ai:action",
});

function normalizeEndpoint(endpoint) {
  const normalized = String(endpoint || "").trim().toLowerCase();
  if (!ENDPOINT_PERMISSION[normalized]) {
    throw badRequest("Unsupported AI endpoint.");
  }
  return normalized;
}

function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] || [];
}

function resolveTenantId(authContext, payload = {}) {
  const requestedTenantId = payload.tenantId || null;
  if (authContext.role === "super_admin") {
    return requestedTenantId || authContext.tenantId || null;
  }

  if (requestedTenantId && requestedTenantId !== authContext.tenantId) {
    throw forbidden("AI requests cannot access another tenant.");
  }

  return authContext.tenantId || null;
}

function buildAiRequestContext(authContext = {}, payload = {}, endpoint = "chat") {
  if (!authContext.userId || !authContext.role) {
    throw forbidden("Authenticated user context is required for AI requests.");
  }

  const normalizedEndpoint = normalizeEndpoint(endpoint);
  const role = String(authContext.role || "").trim();
  const permissions = permissionsForRole(role);
  const requiredPermission = ENDPOINT_PERMISSION[normalizedEndpoint];
  if (!permissions.includes(requiredPermission)) {
    throw forbidden("This role is not allowed to use that AI capability.");
  }

  const tenantId = resolveTenantId(authContext, payload);
  if (role !== "super_admin" && !tenantId) {
    throw forbidden("Tenant context is required for this AI request.");
  }

  return {
    userId: authContext.userId,
    tenantId,
    role,
    parentStudentIds: [],
    permissions,
    endpoint: normalizedEndpoint,
  };
}

module.exports = {
  ENDPOINT_PERMISSION,
  ROLE_PERMISSIONS,
  buildAiRequestContext,
  permissionsForRole,
};

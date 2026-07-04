/**
 * @file toolRegistry.js
 * @description Tool Registry — the execution boundary between AI providers and
 * tool implementations in the HAPOS Business Intelligence system.
 *
 * ARCHITECTURE:
 *
 *   AI Request
 *       ↓
 *   aiPermissions.js   — request-level authentication & session validation
 *       ↓
 *   aiTools.js         — role-based tool authorization (isToolAllowed, requiresConfirmation)
 *       ↓
 *   toolRegistry.js    — THIS FILE: execution gate, registration contract, dispatch
 *       ↓
 *   BaseTool.run()     — validateContext → validateArgs → execute (mandatory pipeline)
 *       ↓
 *   Tool Implementations (must extend BaseTool)
 *       ↓
 *   Application Services
 *
 * @module toolRegistry
 */

"use strict";

const {
  AI_TOOL_CATALOG,
  isToolAllowed,
  requiresConfirmation,
} = require("./aiTools");

// ---------------------------------------------------------------------------
// 1. TOOL REGISTRY
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ToolImplementation
 * @description A BaseTool instance (or structurally compatible object) that
 *   exposes run(), execute(), and metadata().  All tools MUST extend BaseTool;
 *   the registry enforces the presence of these three methods at registration.
 *
 * @property {function({ context: ExecutionContext, args: Object }): Promise<*>} run
 *   Full execution pipeline: validateContext → validateArgs → execute.
 *   executeTool() always dispatches through run() — never execute() directly.
 * @property {function({ context: ExecutionContext, args: Object }): Promise<*>} execute
 *   The tool's core implementation.  Must not be called outside of run() in
 *   production code; the registry validates its presence but dispatches via run().
 * @property {function(): ToolMetadata} metadata
 *   Returns a plain-object descriptor used for capability discovery.
 */

/**
 * @typedef {Object} ToolMetadata
 * @property {string} id          - Unique tool identifier.
 * @property {string} name        - Human-readable display name.
 * @property {string} description - One-sentence capability description.
 * @property {string} category    - Logical grouping (e.g. "Revenue", "Expenses").
 * @property {string} risk        - Risk level: "low" | "medium" | "high" | "critical".
 */

/**
 * @typedef {Object} ExecutionContext
 * @property {string}  tenantId - Session-derived tenant identifier. Never
 *   accepted from caller-supplied input.
 * @property {string}  userId   - Authenticated user identifier.
 * @property {string}  role     - The caller's role (e.g. "shop_admin").
 */

/**
 * @typedef {Object} PrepareResult
 * @property {string}          toolId               - The validated tool identifier.
 * @property {boolean}         allowed              - Always `true` (throws otherwise).
 * @property {boolean}         requiresConfirmation - Whether human confirmation is
 *   required before the tool may be executed.
 * @property {ExecutionContext} context             - Passthrough of the session context.
 * @property {Object}          args                - Passthrough of the caller-supplied arguments.
 */

/**
 * @typedef {Object} RegistryHealth
 * @property {number}   totalCatalogued  - Total tools defined in AI_TOOL_CATALOG.
 * @property {number}   registered       - Number of tools with a registered implementation.
 * @property {number}   unregistered     - Number of tools still awaiting implementation.
 * @property {string[]} implementedTools - Sorted list of registered tool IDs.
 * @property {string[]} missingTools     - Sorted list of unregistered tool IDs.
 */

/**
 * Mutable internal registry — implementations are populated via {@link registerTool}.
 * Keys mirror every tool ID in {@link AI_TOOL_CATALOG}; values begin as `null`
 * and are replaced with a {@link ToolImplementation} upon registration.
 *
 * The object itself is NOT frozen so that `registerTool` can write into it, but
 * each registered implementation is stored by reference (BaseTool instances are
 * already frozen at the property level by their constructor).
 *
 * @type {Record<string, ToolImplementation|null>}
 */
const _registry = AI_TOOL_CATALOG.reduce((acc, tool) => {
  acc[tool.id] = null;
  return acc;
}, /** @type {Record<string, ToolImplementation|null>} */ ({}));

/**
 * Public frozen snapshot of the registry's key set.
 * Exposes which tool IDs the registry recognises without surfacing the mutable
 * internal store.  Values are always `null` in this snapshot; use {@link getTool}
 * to retrieve a live implementation.
 *
 * @type {Readonly<Record<string, null>>}
 */
const TOOL_REGISTRY = Object.freeze(
  AI_TOOL_CATALOG.reduce((acc, tool) => {
    acc[tool.id] = null;
    return acc;
  }, /** @type {Record<string, null>} */ ({}))
);

// ---------------------------------------------------------------------------
// 2. TOOL RESOLUTION
// ---------------------------------------------------------------------------

/**
 * Retrieves the registered implementation for a given tool ID.
 *
 * @param {string} toolId - The tool identifier to resolve.
 * @returns {ToolImplementation} The registered BaseTool instance.
 *
 * @throws {Error} If `toolId` is not a recognised key in the registry.
 * @throws {Error} If the tool is recognised but has not yet been registered
 *   (its registry entry is still `null`).
 *
 * @example
 * const tool = getTool("revenueSummary");
 * await tool.run({ context, args });
 */
function getTool(toolId) {
  if (!Object.prototype.hasOwnProperty.call(_registry, toolId)) {
    throw new Error(
      `Tool "${toolId}" is not a recognised tool ID. ` +
        `Verify the ID against AI_TOOL_CATALOG in aiTools.js.`
    );
  }

  const implementation = _registry[toolId];

  if (implementation === null) {
    throw new Error(
      `Tool "${toolId}" has not been implemented yet. ` +
        `Register a BaseTool instance via registerTool("${toolId}", new MyTool()).`
    );
  }

  return implementation;
}

// ---------------------------------------------------------------------------
// 3. TOOL COLLECTION
// ---------------------------------------------------------------------------

/**
 * Returns the registered implementations for a subset of tool IDs.
 * Unknown IDs and unimplemented tools (still `null`) are silently omitted,
 * making this safe to call with a role's full tool list without crashing on
 * partially-deployed registries.
 *
 * @param {string[]} [toolIds=[]] - Array of tool identifiers to resolve.
 * @returns {Record<string, ToolImplementation>} Map of toolId → BaseTool instance
 *   for every ID that is both recognised and registered.
 *
 * @example
 * const tools = getTools(toolsForRole("finance"));
 * // → { revenueSummary: RevenueSummaryTool, profitAnalysis: ProfitAnalysisTool, ... }
 */
function getTools(toolIds = []) {
  if (!Array.isArray(toolIds)) {
    throw new TypeError(
      `getTools expects an array of tool IDs; received ${typeof toolIds}.`
    );
  }

  return toolIds.reduce((acc, id) => {
    if (
      typeof id === "string" &&
      Object.prototype.hasOwnProperty.call(_registry, id) &&
      _registry[id] !== null
    ) {
      acc[id] = _registry[id];
    }
    return acc;
  }, /** @type {Record<string, ToolImplementation>} */ ({}));
}

// ---------------------------------------------------------------------------
// INTERNAL HELPERS
// ---------------------------------------------------------------------------

/**
 * Asserts that a context object is a well-formed {@link ExecutionContext}.
 * Throws a {@link TypeError} with a descriptive message on the first violation.
 * Used by both prepareToolExecution and executeTool to enforce fail-fast
 * context validation independently of whether the other function was called.
 *
 * @param {*}      context    - Value to validate.
 * @param {string} callerName - Name of the calling function for error messages.
 * @returns {void}
 * @throws {TypeError}
 */
function _assertContext(context, callerName) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw new TypeError(
      `${callerName}: "context" must be a plain object containing ` +
        `session-derived identity (tenantId, userId, role).`
    );
  }

  const missing = ["tenantId", "userId", "role"].filter(
    (k) => !context[k] || typeof context[k] !== "string"
  );

  if (missing.length > 0) {
    throw new TypeError(
      `${callerName}: "context" is missing required field(s): ${missing.join(", ")}. ` +
        `These values must be derived from the authenticated session, never from caller input.`
    );
  }
}

/**
 * Asserts that the explicit `role` parameter matches `context.role`.
 * The authenticated session context is the single source of truth for identity.
 * A mismatch indicates a caller bug or a spoofing attempt and must be rejected
 * before any authorization check is performed.
 *
 * @param {string} role        - The role supplied directly by the caller.
 * @param {string} contextRole - The role embedded in the session context.
 * @param {string} callerName  - Name of the calling function for error messages.
 * @returns {void}
 * @throws {Error}
 */
function _assertRoleMatchesContext(role, contextRole, callerName) {
  if (role !== contextRole) {
    throw new Error(
      `${callerName}: Role mismatch: supplied role "${role}" does not match ` +
        `context.role "${contextRole}". ` +
        `The session context is the authoritative source of identity.`
    );
  }
}

// ---------------------------------------------------------------------------
// 4. PERMISSION ENFORCEMENT
// ---------------------------------------------------------------------------

/**
 * Validates that a given role is permitted to invoke a specific tool.
 * This is a synchronous, throw-on-deny guard intended to be called before
 * any tool resolution or execution attempt.
 *
 * Enforces two sequential checks:
 *   1. The tool ID must exist in the registry (catalog check).
 *   2. The role must be listed for that tool in ROLE_TOOLS (authorization check).
 *
 * A successful return does NOT mean the tool is implemented, nor does it waive
 * the tool's own ownership, tenant-isolation, or business-rule checks.
 *
 * @param {string} role   - The caller's role (e.g. "shop_admin", "staff").
 * @param {string} toolId - The tool identifier being requested.
 * @returns {void}
 *
 * @throws {Error} If `toolId` is not recognised in the registry.
 * @throws {Error} If the role is not authorised to invoke the tool.
 *
 * @example
 * validateToolAccess("shop_admin", "revenueSummary");     // passes silently
 * validateToolAccess("staff", "executiveSummary"); // throws
 */
function validateToolAccess(role, toolId) {
  if (!Object.prototype.hasOwnProperty.call(_registry, toolId)) {
    throw new Error(
      `Access denied: "${toolId}" is not a recognised tool ID. ` +
        `Verify the ID against AI_TOOL_CATALOG in aiTools.js.`
    );
  }

  if (!isToolAllowed(role, toolId)) {
    throw new Error(
      `Access denied: role "${role}" is not authorised to invoke tool "${toolId}".`
    );
  }
}

// ---------------------------------------------------------------------------
// 5. EXECUTION PREPARATION
// ---------------------------------------------------------------------------

/**
 * Validates access and assembles execution metadata for a tool call without
 * performing any execution.
 *
 * Checks performed (in order):
 *   1. `context` is a well-formed {@link ExecutionContext}.
 *   2. `role` matches `context.role` (role-mismatch guard).
 *   3. `role` is authorised to invoke `toolId` (via {@link validateToolAccess}).
 *
 * Callers (AI agent frameworks, API controllers) MUST inspect the returned
 * `requiresConfirmation` flag.  When `true`, they MUST obtain explicit human
 * approval and record the approval event before proceeding to `executeTool`.
 *
 * AUDIT HOOK — future integration point:
 *   After a successful return, the orchestration layer should emit an audit
 *   event with the following fields before presenting the confirmation prompt
 *   or proceeding to execution:
 *
 *   {
 *     event:                "tool.prepare",
 *     toolId:               <string>,
 *     tenantId:             context.tenantId,
 *     userId:               context.userId,
 *     role:                 context.role,
 *     timestamp:            <ISO-8601>,
 *     requiresConfirmation: <boolean>,
 *   }
 *
 *   On failure (thrown error), emit:
 *   {
 *     event:     "tool.prepare.denied",
 *     toolId:    <string>,
 *     tenantId:  context.tenantId  (if available),
 *     userId:    context.userId    (if available),
 *     role:      <string>,
 *     timestamp: <ISO-8601>,
 *     reason:    error.message,
 *   }
 *
 * @param {Object}          params           - Preparation parameters.
 * @param {string}          params.role      - The caller's role.  Must equal
 *   `context.role`; the session context is the authoritative source of identity.
 * @param {string}          params.toolId    - The tool identifier being requested.
 * @param {ExecutionContext} params.context  - Session-derived identity context.
 *   Must contain `tenantId`, `userId`, and `role` as non-empty strings.
 * @param {Object}          [params.args={}] - Caller-supplied tool arguments.
 * @returns {PrepareResult} Frozen execution metadata object.
 *
 * @throws {TypeError} If `context` is missing, not a plain object, or incomplete.
 * @throws {Error}     If `role` does not match `context.role`.
 * @throws {Error}     If access validation fails (see {@link validateToolAccess}).
 *
 * @example
 * const plan = prepareToolExecution({
 *   role: "finance",
 *   toolId: "paymentRecording",
 *   context: { tenantId: "tenant-royal-fades", userId: "usr-7", role: "shop_admin" },
 *   args: { period: "this_month" },
 * });
 * // → { toolId: "paymentRecording", allowed: true, requiresConfirmation: true, context: {...}, args: {...} }
 */
function prepareToolExecution({ role, toolId, context, args = {} }) {
  // 1. Validate context shape before anything else.
  _assertContext(context, "prepareToolExecution");

  // 2. Role supplied by the caller must match the session-derived role.
  _assertRoleMatchesContext(role, context.role, "prepareToolExecution");

  // 3. Authorization check — throws if denied.
  // AUDIT HOOK: on catch, emit "tool.prepare.denied" with toolId, context, role, reason.
  validateToolAccess(role, toolId);

  // AUDIT HOOK: emit "tool.prepare" with toolId, context, requiresConfirmation, timestamp.

  return Object.freeze({
    toolId,
    allowed: true,
    requiresConfirmation: requiresConfirmation(toolId),
    context: Object.freeze({ ...context }),
    args: Object.freeze({ ...args }),
  });
}

// ---------------------------------------------------------------------------
// 6. EXECUTION
// ---------------------------------------------------------------------------

/**
 * Validates permissions, resolves the tool implementation, and dispatches the
 * call through BaseTool.run().  This is the sole authorised execution path for
 * all AI tool calls.
 *
 * DISPATCH CONTRACT:
 *   Execution is always routed through tool.run({ context, args }), never
 *   tool.execute() directly.  BaseTool.run() guarantees the full pipeline:
 *
 *     validateContext()  — re-confirms context shape inside the tool boundary
 *         ↓
 *     validateArgs()     — tool-specific argument validation
 *         ↓
 *     execute()          — the tool's core implementation
 *
 *   This means context and argument validation runs twice for defence-in-depth:
 *   once here at the registry boundary (via _assertContext) and once inside
 *   BaseTool.run() at the tool boundary.  The duplication is intentional.
 *
 * Checks performed by this function (in order):
 *   1. `context` is a well-formed {@link ExecutionContext} (fail-fast; does not
 *      rely on prepareToolExecution having been called previously).
 *   2. `role` matches `context.role` (role-mismatch guard).
 *   3. `role` is authorised to invoke `toolId` (re-validated on every call).
 *   4. Tool has a registered implementation.
 *   5. Dispatches to tool.run(); annotates any thrown error with debugging fields.
 *
 * ERROR ANNOTATION:
 *   Errors thrown by the tool pipeline are caught, annotated with `toolId`,
 *   `role`, and `tenantId`, then re-thrown.  This preserves the original error
 *   type and stack trace while making structured logging straightforward.
 *
 * IMPORTANT — Confirmation responsibility:
 *   This function does NOT block on human confirmation for high/critical tools.
 *   The caller is responsible for obtaining and recording confirmation (using
 *   `prepareToolExecution` to detect the requirement) before calling `executeTool`.
 *   Bypassing that responsibility is a security violation, not a framework error.
 *
 * AUDIT HOOK — future integration point:
 *   Wrap the tool.run() call to capture success and failure outcomes.
 *   Emit the following audit fields immediately before dispatch:
 *
 *   {
 *     event:     "tool.execute.attempt",
 *     toolId:    <string>,
 *     tenantId:  context.tenantId,
 *     userId:    context.userId,
 *     role:      context.role,
 *     timestamp: <ISO-8601>,
 *   }
 *
 *   On success, emit:
 *   {
 *     event:     "tool.execute.success",
 *     toolId:    <string>,
 *     tenantId:  context.tenantId,
 *     userId:    context.userId,
 *     role:      context.role,
 *     timestamp: <ISO-8601>,
 *   }
 *
 *   On failure, emit:
 *   {
 *     event:     "tool.execute.failure",
 *     toolId:    <string>,
 *     tenantId:  context.tenantId,
 *     userId:    context.userId,
 *     role:      context.role,
 *     timestamp: <ISO-8601>,
 *     reason:    error.message,
 *   }
 *
 *   Always re-throw the original error after logging a failure event.
 *
 * @param {Object}          params           - Execution parameters.
 * @param {string}          params.role      - The caller's role.  Must equal
 *   `context.role`; the session context is the authoritative source of identity.
 * @param {string}          params.toolId    - The tool identifier to execute.
 * @param {ExecutionContext} params.context  - Session-derived identity context.
 *   Must contain `tenantId`, `userId`, and `role` as non-empty strings.
 * @param {Object}          [params.args={}] - Caller-supplied tool arguments.
 * @returns {Promise<*>} Resolves with the tool implementation's return value.
 *
 * @throws {TypeError} If `context` is missing, not a plain object, or incomplete.
 * @throws {Error}     If `role` does not match `context.role`.
 * @throws {Error}     If access validation fails (see {@link validateToolAccess}).
 * @throws {Error}     If the tool has not been registered yet.
 * @throws {*}         Any error thrown by the tool pipeline, annotated with
 *   `error.toolId`, `error.role`, and `error.tenantId`, then re-thrown.
 *
 * @example
 * const result = await executeTool({
 *   role: "finance",
 *   toolId: "feeBalanceLookup",
 *   context: { tenantId: "tenant-royal-fades", userId: "usr-7", role: "shop_admin" },
 *   args: { period: "this_month" },
 * });
 */
async function executeTool({ role, toolId, context, args = {} }) {
  // 1. Fail-fast context validation — independent of prepareToolExecution.
  _assertContext(context, "executeTool");

  // 2. Role supplied by the caller must match the session-derived role.
  _assertRoleMatchesContext(role, context.role, "executeTool");

  // 3. Re-validate authorization on every execution call — never trust upstream
  //    caching of auth decisions (avoids TOCTOU window between prepare and execute).
  // AUDIT HOOK: on catch, emit "tool.execute.failure" with toolId, context, reason.
  validateToolAccess(role, toolId);

  // 4. Resolve implementation — throws if not yet registered.
  const tool = getTool(toolId);

  // 5. Dispatch through BaseTool.run() — guarantees validateContext → validateArgs
  //    → execute pipeline.  Annotate any thrown error with debugging context so
  //    structured loggers can record toolId, role, and tenant without unwrapping
  //    the error message.
  //
  // AUDIT HOOK: emit "tool.execute.attempt" with toolId, context, timestamp.
  // AUDIT HOOK: on success, emit "tool.execute.success" with toolId, context, timestamp.
  // AUDIT HOOK: on failure, emit "tool.execute.failure" with toolId, context, reason, timestamp.
  try {
    return await tool.run({ context, args });
  } catch (error) {
    error.toolId   = toolId;
    error.role     = role;
    error.tenantId = context.tenantId;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// 7. REGISTRATION
// ---------------------------------------------------------------------------

/**
 * Registers a BaseTool instance against a known tool ID.
 *
 * Validates that:
 *   - `toolId` exists as a key in the registry (catalogued in aiTools.js).
 *   - No implementation is already registered for this ID (prevents silent overwrites).
 *   - `implementation` is a non-null object (BaseTool instance check is structural).
 *   - `implementation.run` is a function (BaseTool execution pipeline entry point).
 *   - `implementation.execute` is a function.  MUST be asynchronous and return a
 *     Promise; not mechanically enforced here but a strict contract requirement.
 *   - `implementation.metadata` is a function (capability discovery interface).
 *
 * The registry stores the implementation reference directly (BaseTool instances
 * are not plain objects and must not be spread/frozen by the registry).
 *
 * Rejecting structurally invalid tools at registration time (startup) prevents
 * runtime failures during execution when it is too late to surface the error cleanly.
 *
 * @param {string}             toolId         - The tool ID to register against.
 * @param {ToolImplementation} implementation - A BaseTool instance (or structurally
 *   compatible object) exposing run(), execute(), and metadata().
 * @returns {void}
 *
 * @throws {Error}     If `toolId` is not recognised in the catalog.
 * @throws {Error}     If an implementation is already registered for this ID.
 *   Call {@link deregisterTool} first if replacement is intentional.
 * @throws {TypeError} If `implementation` is not a non-null object.
 * @throws {TypeError} If `implementation.run` is not a function.
 * @throws {TypeError} If `implementation.execute` is not a function.
 * @throws {TypeError} If `implementation.metadata` is not a function.
 *
 * @example
 * const { RevenueSummaryTool } = require("./tools/revenueSummaryTool");
 * registerTool("revenueSummary", new RevenueSummaryTool({ repo: biRepo }));
 */
function registerTool(toolId, implementation) {
  // --- Catalog check ---------------------------------------------------------

  if (!Object.prototype.hasOwnProperty.call(_registry, toolId)) {
    throw new Error(
      `registerTool: "${toolId}" is not a recognised tool ID. ` +
        `Only tool IDs listed in AI_TOOL_CATALOG (aiTools.js) may be registered.`
    );
  }

  // --- Duplicate registration guard ------------------------------------------

  if (_registry[toolId] !== null) {
    throw new Error(
      `registerTool: an implementation for "${toolId}" is already registered. ` +
        `Duplicate registrations are not permitted. ` +
        `Call deregisterTool("${toolId}") first if replacement is intentional.`
    );
  }

  // --- Structural type check --------------------------------------------------

  if (
    implementation === null ||
    typeof implementation !== "object" ||
    Array.isArray(implementation)
  ) {
    throw new TypeError(
      `registerTool: implementation for "${toolId}" must be a BaseTool instance ` +
        `(non-null object exposing run(), execute(), and metadata()). ` +
        `Received: ${implementation === null ? "null" : typeof implementation}.`
    );
  }

  // --- BaseTool contract enforcement -----------------------------------------
  //
  // All three methods are required.  Validating at registration time (startup)
  // surfaces missing methods before any request is served, rather than failing
  // silently at runtime inside executeTool.

  if (typeof implementation.run !== "function") {
    throw new TypeError(
      `registerTool: implementation for "${toolId}" must expose a run() method. ` +
        `Received typeof run: "${typeof implementation.run}". ` +
        `Ensure the tool extends BaseTool — executeTool dispatches through run().`
    );
  }

  if (typeof implementation.execute !== "function") {
    throw new TypeError(
      `registerTool: implementation for "${toolId}" must expose an execute() method. ` +
        `Received typeof execute: "${typeof implementation.execute}". ` +
        `execute() must be asynchronous and return a Promise.`
    );
  }

  if (typeof implementation.metadata !== "function") {
    throw new TypeError(
      `registerTool: implementation for "${toolId}" must expose a metadata() method. ` +
        `Received typeof metadata: "${typeof implementation.metadata}". ` +
        `metadata() must return { id, name, description, category, risk }.`
    );
  }

  // --- Store reference -------------------------------------------------------
  //
  // BaseTool instances must not be spread or re-frozen; the constructor already
  // locks individual metadata properties.  Store the reference directly.

  _registry[toolId] = implementation;
}

/**
 * Removes a registered tool implementation, resetting its registry entry to `null`.
 * Intended for use in test teardown, hot-reload scenarios, and intentional
 * implementation replacement (call deregisterTool then registerTool).
 *
 * @param {string} toolId - The tool ID whose implementation should be removed.
 * @returns {void}
 *
 * @throws {Error} If `toolId` is not a recognised tool ID in the catalog.
 * @throws {Error} If the tool has no registered implementation (already `null`).
 *
 * @example
 * deregisterTool("revenueSummary");
 * // _registry["revenueSummary"] is now null; re-registration is permitted.
 */
function deregisterTool(toolId) {
  if (!Object.prototype.hasOwnProperty.call(_registry, toolId)) {
    throw new Error(
      `deregisterTool: "${toolId}" is not a recognised tool ID. ` +
        `Only tool IDs listed in AI_TOOL_CATALOG (aiTools.js) may be deregistered.`
    );
  }

  if (_registry[toolId] === null) {
    throw new Error(
      `deregisterTool: "${toolId}" has no registered implementation to remove. ` +
        `Use registerTool("${toolId}", new MyTool()) to register one first.`
    );
  }

  _registry[toolId] = null;
}

// ---------------------------------------------------------------------------
// 8. REGISTRY INTROSPECTION
// ---------------------------------------------------------------------------

/**
 * Returns the IDs of all tools that have a registered implementation.
 * Useful for startup diagnostics, health checks, and capability discovery.
 *
 * @returns {string[]} Sorted array of registered tool IDs.
 *
 * @example
 * registeredTools();
 * // → ["revenueSummary", "profitAnalysis"]
 */
function registeredTools() {
  return Object.keys(_registry)
    .filter((id) => _registry[id] !== null)
    .sort();
}

/**
 * Returns the IDs of all tools that are catalogued but not yet registered
 * (their registry entry is still `null`).
 * Useful for deployment gap analysis and progressive rollout tracking.
 *
 * @returns {string[]} Sorted array of unregistered tool IDs.
 *
 * @example
 * unregisteredTools();
 * // → ["admissionsAnalysis", "anonymousClassPerformanceSummary", ...]
 */
function unregisteredTools() {
  return Object.keys(_registry)
    .filter((id) => _registry[id] === null)
    .sort();
}

// ---------------------------------------------------------------------------
// 9. CAPABILITY DISCOVERY
// ---------------------------------------------------------------------------

/**
 * Returns the metadata descriptor for a single registered tool.
 * Delegates to the tool's own metadata() method, which is sourced from
 * the BaseTool constructor fields (id, name, description, category, risk).
 *
 * Intended for AI provider tool registration, capability listing, and
 * runtime debugging.  Never used for authorization or execution decisions.
 *
 * @param {string} toolId - The tool identifier to inspect.
 * @returns {ToolMetadata} Plain-object descriptor for the tool.
 *
 * @throws {Error} If `toolId` is not recognised in the registry.
 * @throws {Error} If the tool has not been registered yet (still `null`).
 *
 * @example
 * getToolMetadata("revenueSummary");
 * // → { id: "revenueSummary", name: "Revenue Summary", description: "...",
 * //     category: "Revenue", risk: "low" }
 */
function getToolMetadata(toolId) {
  const tool = getTool(toolId); // throws if unknown or unregistered
  return tool.metadata();
}

/**
 * Returns metadata descriptors for every currently registered tool.
 * Order is not guaranteed; callers should sort if presentation order matters.
 *
 * Useful for bulk AI provider tool registration, health dashboards, and
 * debugging which tool definitions are live in the current process.
 *
 * @returns {ToolMetadata[]} Array of metadata objects for all registered tools.
 *   Returns an empty array if no tools are registered yet.
 *
 * @example
 * allToolMetadata();
 * // → [
 * //   { id: "attendanceLookup", name: "Attendance Lookup", ..., risk: "low" },
 * //   { id: "revenueSummary",   name: "Revenue Summary",   ..., risk: "low" },
 * // ]
 */
function allToolMetadata() {
  return registeredTools().map((id) => _registry[id].metadata());
}

// ---------------------------------------------------------------------------
// 10. STARTUP DIAGNOSTICS
// ---------------------------------------------------------------------------

/**
 * Returns a snapshot of the registry's registration completeness.
 * Intended for application startup validation and health monitoring.
 *
 * Typical usage:
 *
 *   const health = registryHealth();
 *   if (health.unregistered > 0) {
 *     logger.warn("Incomplete tool registry at startup", health);
 *   }
 *
 * @returns {RegistryHealth} Registration completeness summary.
 *
 * @example
 * registryHealth();
 * // → {
 * //   totalCatalogued:  12,
 * //   registered:        2,
 * //   unregistered:     10,
 * //   implementedTools: ["revenueSummary", "profitAnalysis"],
 * //   missingTools:     ["supplierInsights", "taxSummary", ...]
 * // }
 */
function registryHealth() {
  const implemented = registeredTools();
  const missing     = unregisteredTools();

  return {
    totalCatalogued:  implemented.length + missing.length,
    registered:       implemented.length,
    unregistered:     missing.length,
    implementedTools: implemented,
    missingTools:     missing,
  };
}

// ---------------------------------------------------------------------------
// 11. EXPORTS
// ---------------------------------------------------------------------------

module.exports = Object.freeze({
  TOOL_REGISTRY,
  registerTool,
  deregisterTool,
  getTool,
  getTools,
  validateToolAccess,
  prepareToolExecution,
  executeTool,
  registeredTools,
  unregisteredTools,
  getToolMetadata,
  allToolMetadata,
  registryHealth,
});

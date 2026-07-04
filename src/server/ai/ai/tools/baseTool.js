/**
 * @file baseTool.js
 * @description Abstract base class for all HAPOS AI tool implementations.
 *
 * ARCHITECTURE:
 *
 *   AI Request
 *       ↓
 *   toolRegistry.js    — execution gate, registration contract, dispatch
 *       ↓
 *   BaseTool.run()     — THIS FILE: pipeline orchestration (validateContext →
 *                        validateArgs → execute)
 *       ↓
 *   BaseTool.execute() — overridden by each concrete tool subclass
 *       ↓
 *   Application Services
 *
 * @module baseTool
 */

"use strict";

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------

/**
 * Exhaustive set of permitted risk levels, ordered from lowest to highest impact.
 * Values mirror the `risk` field in AI_TOOL_CATALOG (aiTools.js) so that the
 * registry and tool implementations share a single vocabulary.
 *
 * @type {readonly string[]}
 */
const VALID_RISK_LEVELS = Object.freeze(["low", "medium", "high", "critical"]);

// ---------------------------------------------------------------------------
// BASE TOOL
// ---------------------------------------------------------------------------

/**
 * Abstract base class for all HAPOS AI tool implementations.
 */
class BaseTool {
  // -------------------------------------------------------------------------
  // CONSTRUCTOR
  // -------------------------------------------------------------------------

  /**
   * Constructs and freezes tool metadata.
   *
   * @param {Object} params               - Tool descriptor.
   * @param {string} params.id            - Unique tool identifier matching the
 *   corresponding entry in AI_TOOL_CATALOG (e.g. `"revenueSummary"`).
 * @param {string} params.name          - Human-readable display name
 *   (e.g. `"Revenue Summary"`).
   * @param {string} params.description   - One-sentence description of what the
   *   tool does; surfaced to the AI provider as capability documentation.
   * @param {string} [params.category="general"] - Logical grouping used for
   *   discovery and UI organisation (e.g. `"Revenue"`, `"Customers"`).
   * @param {string} [params.risk="low"]  - Risk classification for this tool.
   *   Must be one of: `"low"`, `"medium"`, `"high"`, `"critical"`.
   *   High-risk and critical tools require human confirmation before execution;
   *   see `toolRegistry.js` for enforcement details.
   *
   * @throws {TypeError} If `id` is missing or not a non-empty string.
   * @throws {TypeError} If `name` is missing or not a non-empty string.
   * @throws {TypeError} If `description` is missing or not a non-empty string.
   * @throws {TypeError} If `risk` is not one of the permitted risk levels.
   */
  constructor({
    id,
    name,
    description,
    category = "general",
    risk = "low",
  } = {}) {
    // --- Required field validation -------------------------------------------

    if (!id || typeof id !== "string") {
      throw new TypeError(
        `BaseTool: "id" is required and must be a non-empty string. ` +
          `Received: ${JSON.stringify(id)}.`
      );
    }

    if (!name || typeof name !== "string") {
      throw new TypeError(
        `BaseTool "${id}": "name" is required and must be a non-empty string. ` +
          `Received: ${JSON.stringify(name)}.`
      );
    }

    if (!description || typeof description !== "string") {
      throw new TypeError(
        `BaseTool "${id}": "description" is required and must be a non-empty string. ` +
          `Received: ${JSON.stringify(description)}.`
      );
    }

    // --- Risk level validation -----------------------------------------------

    if (!VALID_RISK_LEVELS.includes(risk)) {
      throw new TypeError(
        `BaseTool "${id}": "risk" must be one of ` +
          `[${VALID_RISK_LEVELS.map((r) => `"${r}"`).join(", ")}]. ` +
          `Received: ${JSON.stringify(risk)}.`
      );
    }

    // --- Freeze metadata onto the instance -----------------------------------
    //
    // Properties are defined as non-writable, non-configurable descriptors so
    // that subclass code cannot accidentally mutate identity fields after
    // construction.  The descriptor approach also means Object.freeze() on the
    // instance is not required — individual fields are locked while the object
    // remains extensible for subclass method assignment.

    Object.defineProperties(this, {
      /** @type {string} Unique tool identifier. */
      id: { value: id, writable: false, enumerable: true, configurable: false },

      /** @type {string} Human-readable display name. */
      name: {
        value: name,
        writable: false,
        enumerable: true,
        configurable: false,
      },

      /** @type {string} One-sentence capability description. */
      description: {
        value: description,
        writable: false,
        enumerable: true,
        configurable: false,
      },

      /** @type {string} Logical category for grouping and discovery. */
      category: {
        value: category,
        writable: false,
        enumerable: true,
        configurable: false,
      },

      /** @type {string} Risk classification; drives confirmation requirements. */
      risk: {
        value: risk,
        writable: false,
        enumerable: true,
        configurable: false,
      },
    });
  }

  // -------------------------------------------------------------------------
  // CONTEXT VALIDATION
  // -------------------------------------------------------------------------

  /**
   * Validates that `context` is a well-formed session context object.
   * Called automatically by {@link run} before `validateArgs` or `execute`.
   *
   * A valid context must be a plain object containing all three of the
   * following as non-empty strings:
   *
   *   - `tenantId` — session-derived tenant identifier; never accepted from
   *     caller-supplied input.
   *   - `userId`   — authenticated user identifier.
   *   - `role`     — the caller's role (e.g. `"shop_admin"`, `"staff"`).
   *
   * This method validates *shape only*.  It does NOT enforce tenant isolation
   * or ownership — those responsibilities remain inside `execute()`.
   *
   * @param {*} context - The value to validate.
   * @returns {void}
   *
   * @throws {TypeError} If `context` is not a plain object.
   * @throws {TypeError} If any of `tenantId`, `userId`, or `role` is missing
   *   or is not a non-empty string.
   */
  validateContext(context) {
    if (!context || typeof context !== "object" || Array.isArray(context)) {
      throw new TypeError(
        `Tool "${this.id}": "context" must be a plain object containing ` +
          `session-derived identity (tenantId, userId, role). ` +
          `Received: ${typeof context}.`
      );
    }

    const missing = ["tenantId", "userId", "role"].filter(
      (key) => !context[key] || typeof context[key] !== "string"
    );

    if (missing.length > 0) {
      throw new TypeError(
        `Tool "${this.id}": "context" is missing required field(s): ` +
          `${missing.join(", ")}. ` +
          `These values must be derived from the authenticated session, ` +
          `never from caller-supplied input.`
      );
    }
  }

  // -------------------------------------------------------------------------
  // ARGUMENT VALIDATION
  // -------------------------------------------------------------------------

  /**
   * Validates caller-supplied tool arguments.
   *
   * The default implementation accepts any arguments without inspection.
   * Concrete subclasses SHOULD override this method to enforce the specific
   * parameter contract for their tool (required fields, types, value ranges,
   * etc.).
   *
   * Called automatically by {@link run} after `validateContext` and before
   * `execute`.  Throw a descriptive error to reject a call before any
   * application-layer work is performed.
   *
   * @param {Object} args - Caller-supplied arguments for the tool invocation.
   * @returns {true} Returns `true` on success (allows override to be concise).
   *
 * @example
 * // Overriding in a subclass:
 * validateArgs(args) {
 *   if (!args.period || typeof args.period !== "string") {
 *     throw new TypeError(`Tool "${this.id}": "args.period" is required.`);
 *   }
 *   return true;
 * }
   */
  // eslint-disable-next-line no-unused-vars
  validateArgs(args) {
    return true;
  }

  // -------------------------------------------------------------------------
  // EXECUTION (ABSTRACT)
  // -------------------------------------------------------------------------

  /**
   * Performs the tool's work.  **Must be overridden by every concrete subclass.**
   *
   * This default implementation always throws, making `BaseTool` effectively
   * abstract.  The registry will surface this error if a subclass is registered
   * without overriding `execute`.
   *
   * Implementation responsibilities (NOT enforced by BaseTool):
   *   - Scope all data access to `context.tenantId` (tenant isolation).
   *   - Verify the authenticated user owns the requested resource (ownership).
   *   - Apply all domain business rules (fee limits, enrolment status, etc.).
   *
   * @param {Object}          params         - Execution parameters.
   * @param {ExecutionContext} params.context - Validated session context
   *   (`tenantId`, `userId`, `role`).  Already confirmed well-formed by `run`.
   * @param {Object}          params.args    - Validated caller-supplied
   *   arguments.  Already passed through `validateArgs` by `run`.
   * @returns {Promise<*>} Must return a Promise (i.e. the method must be async
   *   or explicitly return `Promise.resolve(...)`).
   *
   * @throws {Error} Always — subclasses must override this method.
   */
  // eslint-disable-next-line no-unused-vars
  async execute({ context, args }) {
    throw new Error(
      `Tool "${this.id}" must implement execute(). ` +
        `Extend BaseTool and override execute({ context, args }).`
    );
  }

  // -------------------------------------------------------------------------
  // EXECUTION PIPELINE
  // -------------------------------------------------------------------------

  /**
   * Orchestrates the full tool execution pipeline:
   *
   *   1. `validateContext(context)` — asserts well-formed session identity.
   *   2. `validateArgs(args)`       — asserts well-formed caller arguments.
   *   3. `execute({ context, args })` — dispatches to the concrete implementation.
   *
   * This is the **only** method that should be called externally (typically by
   * `toolRegistry.js`).  Calling `execute()` directly bypasses the validation
   * pipeline and must not be done outside of tests.
   *
   * @param {Object}          params           - Run parameters.
   * @param {ExecutionContext} params.context  - Session-derived identity context.
   *   Must contain `tenantId`, `userId`, and `role` as non-empty strings.
   * @param {Object}          [params.args={}] - Caller-supplied tool arguments.
   * @returns {Promise<*>} Resolves with the value returned by `execute()`.
   *
   * @throws {TypeError} If `context` fails validation (see {@link validateContext}).
   * @throws {TypeError} If `args` fails validation (see {@link validateArgs}).
   * @throws {Error}     If the subclass has not overridden `execute()`.
   * @throws {*}         Any error thrown by `execute()` propagates as-is.
   */
  async run({ context, args = {} }) {
    this.validateContext(context);
    this.validateArgs(args);
    return await this.execute({ context, args });
  }

  // -------------------------------------------------------------------------
  // METADATA
  // -------------------------------------------------------------------------

  /**
   * Returns a plain-object snapshot of the tool's immutable metadata.
   * Useful for tool discovery, capability listings, health checks, and
   * surfacing tool definitions to AI providers.
   *
   * The returned object is a shallow copy — mutating it does not affect the
   * instance properties.
   *
   * @returns {{ id: string, name: string, description: string, category: string, risk: string }}
   *
 * @example
 * const tool = new RevenueSummaryTool();
 * tool.metadata();
 * // → { id: "revenueSummary", name: "Revenue Summary", description: "...",
 * //     category: "Revenue", risk: "low" }
   */
  metadata() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      category: this.category,
      risk: this.risk,
    };
  }
}

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------

module.exports = BaseTool;

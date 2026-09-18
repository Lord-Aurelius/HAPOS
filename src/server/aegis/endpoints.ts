/**
 * Canonical HAPOS AI/API connection endpoints (single source of truth).
 *
 * These paths MUST match the route handlers under src/app/api/v1/ai. The
 * Connections portal page and any client honoring the connection contract
 * build absolute URLs as `${PUBLIC_APP_URL}${path}` via getPublicAppBaseUrl —
 * never by duplicating path strings.
 */

export const AI_CONNECTION_ENDPOINTS = {
  connection: '/api/v1/ai/connection',
  shopGrounding: '/api/v1/ai/connection/shop',
  invoke: '/api/v1/ai/invoke',
  events: '/api/v1/ai/events',
  keys: '/api/v1/ai/keys',
  keysRevoke: '/api/v1/ai/keys/revoke',
  tools: '/api/v1/ai/tools',
  chat: '/api/v1/ai/chat',
} as const;

export type AiConnectionEndpoint = (typeof AI_CONNECTION_ENDPOINTS)[keyof typeof AI_CONNECTION_ENDPOINTS];

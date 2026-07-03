"use strict";

const MAX_HISTORY_PER_CONVERSATION = 50;

const _conversations = new Map();
const _entities = new Map();
const _reportingContexts = new Map();

function _key(tenantId, userId, conversationId) {
  return `${tenantId || "none"}::${userId}::${conversationId || "default"}`;
}

function getConversation(tenantId, userId, conversationId) {
  const k = _key(tenantId, userId, conversationId);
  if (!_conversations.has(k)) _conversations.set(k, []);
  return _conversations.get(k);
}

function addMessage(tenantId, userId, role, content, conversationId) {
  const k = _key(tenantId, userId, conversationId);
  const history = getConversation(tenantId, userId, conversationId);
  history.push({ role, content, timestamp: new Date().toISOString() });
  if (history.length > MAX_HISTORY_PER_CONVERSATION) {
    _conversations.set(k, history.slice(-MAX_HISTORY_PER_CONVERSATION));
  }
}

function clearConversation(tenantId, userId, conversationId) {
  const k = _key(tenantId, userId, conversationId);
  _conversations.delete(k);
  _entities.delete(k);
  _reportingContexts.delete(k);
}

function getEntities(tenantId, userId, conversationId) {
  const k = _key(tenantId, userId, conversationId);
  if (!_entities.has(k)) _entities.set(k, []);
  return _entities.get(k);
}

function addEntity(tenantId, userId, type, value, conversationId) {
  const k = _key(tenantId, userId, conversationId);
  const list = getEntities(tenantId, userId, conversationId);
  const exists = list.some((e) => e.type === type && e.value === value);
  if (!exists) {
    list.push({ type, value, added: new Date().toISOString() });
  }
}

function extractEntitiesFromContent(content) {
  const entities = [];
  const patterns = [
    { type: "customerName", regex: /\b(?:customer|client)\s+(\w+\s+\w+)\b/gi },
    { type: "serviceName", regex: /\b(?:service|treatment)\s+(\w+(?:\s+\w+)*)\b/gi },
    { type: "branchName", regex: /\b(?:branch|shop|location)\s+(\w+(?:\s+\w+)*)\b/gi },
  ];
  for (const { type, regex } of patterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      entities.push({ type, value: match[1] || match[0] });
    }
  }
  return entities;
}

function setReportingContext(tenantId, userId, conversationId, context) {
  const k = _key(tenantId, userId, conversationId);
  _reportingContexts.set(k, context);
}

function getReportingContext(tenantId, userId, conversationId) {
  const k = _key(tenantId, userId, conversationId);
  return _reportingContexts.get(k) || null;
}

module.exports = {
  getConversation,
  addMessage,
  clearConversation,
  getEntities,
  addEntity,
  extractEntitiesFromContent,
  setReportingContext,
  getReportingContext,
};

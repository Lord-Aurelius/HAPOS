/**
 * Assembled AEGIS capability catalog: entity reads, approved writes, and
 * analytics delegation. Single source of truth for advertisement
 * (connection/discovery) and invocation (pipeline).
 */

import { ANALYTICS_SPECS, analyticsCapability } from '@/server/aegis/capabilities/analytics';
import { READ_CAPABILITIES } from '@/server/aegis/capabilities/reads';
import { WRITE_CAPABILITIES } from '@/server/aegis/capabilities/writes';
import { isCapabilityAllowed, type CapabilityDef } from '@/server/aegis/registry';

const ANALYTICS_CAPABILITIES: CapabilityDef[] = ANALYTICS_SPECS.map(analyticsCapability);

const ALL: CapabilityDef[] = [...READ_CAPABILITIES, ...WRITE_CAPABILITIES, ...ANALYTICS_CAPABILITIES];

const BY_ID = new Map<string, CapabilityDef>(ALL.map((def) => [def.id, def]));

export function findCapability(id: string): CapabilityDef | null {
  return BY_ID.get(id) ?? null;
}

export function allCapabilities(): CapabilityDef[] {
  return [...ALL];
}

export type AdvertisedCapability = {
  id: string;
  domain: string;
  description: string;
  type: 'read' | 'action';
  risk: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
    additionalProperties: boolean;
  };
};

/** Capabilities a principal may actually execute (GATE 19: no advertise-then-deny). */
export function advertisedCapabilities(role: 'master' | string): AdvertisedCapability[] {
  return ALL.filter((def) => isCapabilityAllowed(role === 'master' ? 'master' : role, def)).map((def) => {
    const properties: AdvertisedCapability['parameters']['properties'] = {};
    const required: string[] = [];
    for (const [name, param] of Object.entries(def.params)) {
      properties[name] = { type: param.type, description: param.description };
      if (param.required) {
        required.push(name);
      }
    }
    if (def.type === 'action') {
      properties.confirm = { type: 'boolean', description: 'Explicit confirmation. Required true to execute.' };
    }
    return {
      id: def.id,
      domain: def.domain,
      description: def.description,
      type: def.type,
      risk: def.risk,
      parameters: { type: 'object', properties, required, additionalProperties: false },
    };
  });
}

export function capabilityCount(): { total: number; read: number; action: number } {
  return {
    total: ALL.length,
    read: ALL.filter((def) => def.type === 'read').length,
    action: ALL.filter((def) => def.type === 'action').length,
  };
}

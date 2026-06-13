/**
 * Creates a blank agent in the registry (shared by Agents settings screen).
 */
import {
  allocateAgentDisplayName,
  createDefaultAgentEditorPrompts,
  layoutFromFormInput,
} from '@novel-master/core/config-forms/agent';
import type {MobileNovelMasterRuntime} from '../runtime/types';

async function listAgentDisplayNameSlots(
  runtime: MobileNovelMasterRuntime,
) {
  const ids = await runtime.agentRegistry.listAgentIds();
  const slots = [];
  for (const id of ids) {
    try {
      const def = await runtime.agentRegistry.get(id);
      slots.push({id, name: def.name});
    } catch {
      slots.push({id, name: id});
    }
  }
  return slots;
}

/** Creates blank agent in registry; returns new agentId. */
export async function createBlankAgent(
  runtime: MobileNovelMasterRuntime,
  id = `agent-${Date.now()}`,
): Promise<string> {
  const name = allocateAgentDisplayName(await listAgentDisplayNameSlots(runtime));
  await runtime.agentRegistry.upsert(id, {
    name,
    runtime: {maxSteps: 20},
    prompts: layoutFromFormInput(createDefaultAgentEditorPrompts()),
  });
  return id;
}

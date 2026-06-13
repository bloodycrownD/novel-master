/**
 * Creates a blank agent in the registry (shared by Agents settings screen).
 */
import {
  createDefaultAgentEditorPrompts,
  layoutFromFormInput,
} from '@novel-master/core/config-forms/agent';
import type {MobileNovelMasterRuntime} from '../runtime/types';

/** Creates blank agent in registry; returns new agentId. */
export async function createBlankAgent(
  runtime: MobileNovelMasterRuntime,
  id = `agent-${Date.now()}`,
): Promise<string> {
  await runtime.agentRegistry.upsert(id, {
    name: 'new-agent',
    runtime: {maxSteps: 20},
    prompts: layoutFromFormInput(createDefaultAgentEditorPrompts()),
  });
  return id;
}

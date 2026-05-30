# Changelog

## Unreleased

### Breaking

- **Agent runtime source is SQL only** (`agent_definition` table). `{novelMasterHome}/agents.yaml` is no longer read automatically. After upgrade run `nm agent import <path>` or `nm agent migrate` when the registry is empty and `agents.yaml` exists.
- **Removed Core exports**: `agentDefinitionFromJson`, `agentDefinitionToJson`, `agentsBundleFromJson`, `isAgentsBundleDocument`, `compactionPolicyFromJson`, `compactionPolicyToJson`, `deserializeAgentDefinition`, `serializeAgentDefinition`, and `infra/agent-definition-io`.
- **Use instead**: `parseText` / `stringifyText` / `decode` / `encode` with `agentDefinitionSchema` or `compactionPolicySchema` from `@novel-master/core`.
- **`AgentDefinition`** domain type no longer includes `schemaVersion` (wire documents still use `schemaVersion: 1` in YAML/JSON).
- **Deleted** `apps/cli/src/compaction/file-agent-resolver.ts`. Compaction summary agents resolve from the DB registry only. No `NM_AGENT_SOURCE` flag.
- **`nm agent run|continue --agent-id`** requires the agent to exist in the registry (`nm agent import` first).
- **Compaction KKV** values must decode with `compactionPolicySchema`. Legacy policy JSON that fails decode is treated as unset; run `nm compaction set --file <path>` to rewrite.
- **Domain layout**: compaction triggers/action moved under `domain/compaction/`; agent sessions under `domain/agent/session/`.

### Previously documented

- **AgentDefinition** no longer includes `compact`. Configure session compaction globally via `nm compaction set` (KKV module `nm-compaction`). Agent YAML files containing `compact:` are rejected by strict schema validation.
- **`CompactionPipeline.maybeCompact`** signature is now `(session, worktreeDisplay)`; policy is read from `CompactionPolicyStore`.
- **`createCompactionPipeline`** requires `policyStore` and `resolveAgent`. **`createAgentRunner`** requires an explicit `compaction` pipeline (use `createNoOpCompactionPipeline()` in tests).

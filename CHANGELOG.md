# Changelog

## Unreleased

### Breaking

- **AgentDefinition** no longer includes `compact`. Configure session compaction globally via `nm compaction set` (KKV module `nm-compaction`). Agent YAML files containing `compact:` are rejected by strict schema validation.
- **`CompactionPipeline.maybeCompact`** signature is now `(session, worktreeDisplay)`; policy is read from `CompactionPolicyStore`.
- **`createCompactionPipeline`** requires `policyStore` and `resolveAgent`. **`createAgentRunner`** requires an explicit `compaction` pipeline (use `createNoOpCompactionPipeline()` in tests).

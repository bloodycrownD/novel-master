# Novel Master examples

## Global compaction policy + agent registry

`examples/compaction-policy.yaml` references `summarizer` via `action.abstract.agentId`. The CLI resolves that id from the **agent registry** (`agent_definition` in `novel.db`), not from `{novelMasterHome}/agents.yaml`.

Import agents before setting compaction or running with `--agent-id`:

```bash
nm agent import examples/agents.yaml --db .novel-master/novel.db
```

If the registry is empty and `{novelMasterHome}/agents.yaml` already exists:

```bash
nm agent migrate --db .novel-master/novel.db
```

Apply the policy (template has no `enabled`; import sets `enabled: true`):

```bash
nm compaction set --file examples/compaction-policy.yaml --db .novel-master/novel.db
nm compaction show --db .novel-master/novel.db
```

Pause compaction without deleting the policy:

```bash
nm compaction disable --db .novel-master/novel.db
```

Remove the policy entirely:

```bash
nm compaction remove --db .novel-master/novel.db
# alias: nm compaction clear
```

Run a dialogue agent from the registry (after import):

```bash
nm agent run --agent-id writer --db .novel-master/novel.db
```

One-off run from a file without saving to the registry:

```bash
nm agent run --agent-config examples/agents.yaml --agent-id writer --db .novel-master/novel.db
```

`prompts.blocks` is an **ordered map** (YAML keys are block names). Do not use array format or per-block `name` fields.

Dialogue agents must **not** include a `compact:` block; compaction is configured globally only.

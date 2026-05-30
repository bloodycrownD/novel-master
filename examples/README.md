# Novel Master examples

## Global compaction policy + agents bundle

`examples/compaction-policy.yaml` references `summarizer` via `action.abstract.agentId`. The CLI resolves that id from **`{novelMasterHome}/agents.yaml`** (the directory that contains `novel.db`).

Copy the example bundle and policy into your Novel Master home:

```bash
cp examples/agents.yaml .novel-master/agents.yaml
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

Run a dialogue agent from the bundle:

```bash
nm agent run --agent-config examples/agents.yaml --agent-id writer --db .novel-master/novel.db
```

`prompts.blocks` is an **ordered map** (YAML keys are block names). Do not use array format or per-block `name` fields.

Dialogue agents must **not** include a `compact:` block; compaction is configured globally only.

# Novel Master examples

## Global compaction policy + agent registry

`examples/compaction-policy.yaml` references `summarizer` via `action.abstract.agentId`. The CLI resolves that id from a file registry under your Novel Master home (the directory that contains `novel.db`).

Copy the example registry and agents into `.novel-master/` (or set `NOVEL_MASTER_HOME` to another home directory):

```bash
mkdir -p .novel-master/agents
cp examples/agents-registry.example.json .novel-master/agents/registry.json
cp examples/agents/summarizer.yaml .novel-master/agents/summarizer.yaml
# optional: dialogue agent for registry key "writer"
cp examples/agent-writer.yaml .novel-master/agents/writer.yaml
```

Registry paths are relative to the home directory, so `agents/summarizer.yaml` resolves to `.novel-master/agents/summarizer.yaml`.

Apply the policy:

```bash
nm compaction set --file examples/compaction-policy.yaml --db .novel-master/novel.db
nm compaction show --db .novel-master/novel.db
```

Dialogue agents (for example `examples/agent-writer.yaml`) must **not** include a `compact:` block; compaction is configured globally only.

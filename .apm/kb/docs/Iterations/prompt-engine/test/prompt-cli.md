# CLI 验收：Prompt 引擎（nm prompt render）

- 日期: 2026-05-24
- 审查人: pending
- 迭代: prompt-engine
- 仓库根目录: `d:\Dev\Js\novel-master`
- CLI: `node apps/cli/dist/index.js`（`npm run build -w @novel-master/cli` 后；全局 `nm` 需 `npm run link:cli`）
- 环境: `NO_COLOR=1`

**备注:** 本次在**临时库**真实执行并捕获输出。主会话库：

`NOVEL_MASTER_DB=d:\Dev\Js\novel-master\tmp\cli-capture-prompt-20260524\novel.db`

缺 session 场景使用独立库：`d:\Dev\Js\novel-master\tmp\cli-capture-prompt-s6-nosession-20260524\novel.db`

Fixture：`d:\Dev\Js\novel-master\.apm\kb\docs\Iterations\prompt-engine\fixtures\example.yaml`

以下命令均在设置 `NOVEL_MASTER_DB` 后、仓库根目录顺序执行。

---

## S0 建立 project / session 默认作用域

```bash
node apps/cli/dist/index.js project create --name PromptCapture
```

退出码: 0

标准输出:
```
d2f4e2a4-94fa-45ee-a160-ab2a427c78dc
```

---

```bash
node apps/cli/dist/index.js project use --name PromptCapture
```

退出码: 0

标准输出:
```

```

---

```bash
node apps/cli/dist/index.js session create --title prompt-main
```

退出码: 0

标准输出:
```
b523c648-c77c-4fa1-9061-93b07309d42e
```

---

```bash
node apps/cli/dist/index.js session use --session b523c648-c77c-4fa1-9061-93b07309d42e
```

退出码: 0

标准输出:
```

```

---

## S1 Session VFS + worktree 规则 + display

```bash
node apps/cli/dist/index.js session vfs write /notes/prompt.md --text hello-prompt-worktree
```

退出码: 0

标准输出:
```
1
```

---

```bash
node apps/cli/dist/index.js session worktree dir / --rule on
```

退出码: 0

标准输出:
```

```

---

```bash
node apps/cli/dist/index.js session worktree file /notes/prompt.md --mode show
```

退出码: 0

标准输出:
```

```

---

```bash
node apps/cli/dist/index.js session worktree display
```

退出码: 0

标准输出:
```
<file path="/notes/prompt.md" createdAt="2026-05-24 21:29:48" updatedAt="2026-05-24 21:29:48" updatedBy="user">
1|hello-prompt-worktree
</file>
```

---

## S2 追加消息（含字面量 `{{`）

```bash
node apps/cli/dist/index.js message append --role system --content "Rules apply."
```

退出码: 0

标准输出:
```
1d939f1e-f602-4a7e-af8c-8706b365805a
```

---

```bash
node apps/cli/dist/index.js message append --role user --content "{{literal}} in history"
```

退出码: 0

标准输出:
```
8068d10a-c5dd-483d-b3f1-28ed692a82db
```

---

```bash
node apps/cli/dist/index.js message append --role assistant --content "Acknowledged."
```

退出码: 0

标准输出:
```
c28bb268-bb67-4d44-9826-17ce22477905
```

---

## S3 `prompt render` 主路径

```bash
node apps/cli/dist/index.js prompt render --path d:\Dev\Js\novel-master\.apm\kb\docs\Iterations\prompt-engine\fixtures\example.yaml
```

退出码: 0

标准输出:
```
system: You are an assistant.
Worktree:
<file path="/notes/prompt.md" createdAt="2026-05-24 21:29:48" updatedAt="2026-05-24 21:29:48" updatedBy="user">
1|hello-prompt-worktree
</file>

system: Rules apply.
user: {{literal}} in history
assistant: Acknowledged.
user: Today is 2026-05-24 21:30:11（星期日）。
```

---

## S4 display 与 render 中 worktree 片段对照

S1 `session worktree display` 输出的 `<file …>` 块与 S3 stdout 中 `Worktree:` 之后嵌入的文本**一致**（同路径、时间戳与 `1|hello-prompt-worktree` 行）。

---

## S5 不存在的路径

```bash
node apps/cli/dist/index.js prompt render --path d:\Dev\Js\novel-master\tmp\cli-capture-prompt-20260524\no-such-prompt.yaml
```

退出码: 2

标准输出:
```

```

标准错误:
```
ENOENT: no such file or directory, open 'd:\Dev\Js\novel-master\tmp\cli-capture-prompt-20260524\no-such-prompt.yaml'
```

---

## S6 缺 `--path`

```bash
node apps/cli/dist/index.js prompt render
```

退出码: 1

标准输出:
```

```

标准错误:
```
Usage: novel-master prompt render --path <file> [--project <id>] [--session <id>] [--db <path>]
```

---

## S6b 无 project/session（空库）

环境: `NOVEL_MASTER_DB=d:\Dev\Js\novel-master\tmp\cli-capture-prompt-s6-nosession-20260524\novel.db`

```bash
node apps/cli/dist/index.js prompt render --path d:\Dev\Js\novel-master\.apm\kb\docs\Iterations\prompt-engine\fixtures\example.yaml
```

退出码: 2

标准输出:
```

```

标准错误:
```
Missing --project <id> (or run: nm project use --project <id>)
```

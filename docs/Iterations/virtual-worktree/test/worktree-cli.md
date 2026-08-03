# CLI 验收：虚拟工作树（worktree + template pull）

- 日期: 2026-05-24
- 审查人: pending
- 迭代: virtual-worktree
- 仓库根目录: `d:\Dev\Js\novel-master`
- CLI: `node apps/cli/dist/index.js`（`npm run build -w @novel-master/cli` 后）
- 环境: `NO_COLOR=1`

**备注:** 本次在**临时库**真实执行并捕获输出，非默认 `.novel-master/novel.db`。会话开始前设置：

```powershell
$env:NOVEL_MASTER_DB = "d:\Dev\Js\novel-master\tmp\cli-capture-worktree-20260524\novel.db"
```

以下命令均在该环境变量生效后、仓库根目录执行；**无需读者逐条手工跑**（仅供审查/回归对照）。若要用默认库，去掉 `NOVEL_MASTER_DB`，并自行承担覆盖 `.novel-master` 数据的风险。

---

## 1. Global 写入模板 + worktree 规则

```bash
node apps/cli/dist/index.js vfs write /template/global.md --text from-global
```

退出码: 0

标准输出:
```
1
```

标准错误:
```

```

---

## 2. Global worktree dir / file

```bash
node apps/cli/dist/index.js vfs worktree dir /template --sort name --order asc --head 1 --tail 0 --fill filename
```

退出码: 0

标准输出:
```

```

标准错误:
```

```

```bash
node apps/cli/dist/index.js vfs worktree file /template/global.md --mode show
```

退出码: 0

标准输出:
```

```

标准错误:
```

```

```bash
node apps/cli/dist/index.js vfs worktree list
```

退出码: 0

标准输出:
```
kind	path	rule_state	inclusion_mode	display_state
dir	/template	规则·开		
file	/template/global.md		展示	全内容
```

标准错误:
```

```

---

## 3. Project 创建与 template pull（对齐 global）

```bash
node apps/cli/dist/index.js project create --name WtCapture
```

退出码: 0

标准输出:
```
456ff985-d8db-4ea8-9094-e474f2898345
```

标准错误:
```

```

```bash
node apps/cli/dist/index.js project use --name WtCapture
```

退出码: 0

标准输出:
```

```

标准错误:
```

```

```bash
node apps/cli/dist/index.js project template pull
```

退出码: 0

标准输出:
```

```

标准错误:
```

```

```bash
node apps/cli/dist/index.js project worktree list
```

退出码: 0

标准输出:
```
kind	path	rule_state	inclusion_mode	display_state
dir	/template	规则·开		
file	/template/global.md		展示	全内容
```

标准错误:
```

```

---

## 4. Project 头尾优先 + 填充策略

```bash
node apps/cli/dist/index.js project vfs write /template/a.md --text aaa
```

退出码: 0

标准输出:
```
1
```

标准错误:
```

```

```bash
node apps/cli/dist/index.js project vfs write /template/b.md --text bbb
```

退出码: 0

标准输出:
```
1
```

标准错误:
```

```

```bash
node apps/cli/dist/index.js project vfs write /template/c.md --text ccc
```

退出码: 0

标准输出:
```
1
```

标准错误:
```

```

```bash
node apps/cli/dist/index.js project worktree dir /template --sort name --order asc --head 1 --tail 1 --fill filename
```

退出码: 0

标准输出:
```

```

标准错误:
```

```

```bash
node apps/cli/dist/index.js project worktree list
```

退出码: 0

标准输出:
```
kind	path	rule_state	inclusion_mode	display_state
dir	/template	规则·开		
file	/template/a.md		自动	全内容
file	/template/b.md		自动	文件名
file	/template/c.md		自动	全内容
file	/template/global.md		展示	全内容
```

标准错误:
```

```

---

## 5. Session 创建继承 worktree

```bash
node apps/cli/dist/index.js session create --title capture-main
```

退出码: 0

标准输出:
```
012fde20-152f-4e22-ba96-447e5ca59d73
```

标准错误:
```

```

```bash
node apps/cli/dist/index.js session worktree list
```

退出码: 0

标准输出:
```
kind	path	rule_state	inclusion_mode	display_state
dir	/	规则·开		
file	/a.md		自动	全内容
file	/b.md		自动	文件名
file	/c.md		自动	全内容
file	/global.md		展示	全内容
```

标准错误:
```

```

---

## 6. Session template pull（清 extra、保留 message）

```bash
node apps/cli/dist/index.js session vfs write /extra.md --text extra
```

退出码: 0

标准输出:
```
1
```

标准错误:
```

```

```bash
node apps/cli/dist/index.js message append --role user --content keep
```

退出码: 0

标准输出:
```
52e3e509-6cb3-4528-816e-db2623cc6eb7
```

标准错误:
```

```

```bash
node apps/cli/dist/index.js session vfs snapshot list --file /a.md
```

退出码: 0

标准输出:
```

```

标准错误:
```

```

```bash
node apps/cli/dist/index.js session template pull
```

退出码: 0

标准输出:
```

```

标准错误:
```

```

```bash
node apps/cli/dist/index.js session vfs list / -r
```

退出码: 0

标准输出:
```
/a.md
/b.md
/c.md
/global.md
```

标准错误:
```

```

```bash
node apps/cli/dist/index.js session vfs snapshot list --file /a.md
```

退出码: 0

标准输出:
```

```

标准错误:
```

```

```bash
node apps/cli/dist/index.js session vfs records list
```

退出码: 0

标准输出:
```

```

标准错误:
```

```

```bash
node apps/cli/dist/index.js message list
```

退出码: 0

标准输出:
```
52e3e509-6cb3-4528-816e-db2623cc6eb7	1	user	keep
```

标准错误:
```

```

**结论片段:** `/extra.md` 已不在 list；message 仍为 1 条；snapshot/records 为空。

---

## 7. Session 隐藏文件后 display

```bash
node apps/cli/dist/index.js session worktree file /a.md --mode hide
```

退出码: 0

标准输出:
```

```

标准错误:
```

```

```bash
node apps/cli/dist/index.js session worktree list
```

退出码: 0

标准输出:
```
kind	path	rule_state	inclusion_mode	display_state
dir	/	规则·开		
file	/a.md		隐藏	不展示
file	/b.md		自动	全内容
file	/c.md		自动	全内容
file	/global.md		展示	全内容
```

标准错误:
```

```

```bash
node apps/cli/dist/index.js session worktree display
```

退出码: 0

标准输出:
```
<file path="/b.md" createdAt="2026-05-24 20:23:31" updatedAt="2026-05-24 20:23:31" updatedBy="user">
1|bbb
</file>

<file path="/c.md" createdAt="2026-05-24 20:23:31" updatedAt="2026-05-24 20:23:31" updatedBy="user">
1|ccc
</file>

<file path="/global.md" createdAt="2026-05-24 20:23:31" updatedAt="2026-05-24 20:23:31" updatedBy="user">
1|from-global
</file>
```

标准错误:
```

```

**结论片段:** `/a.md` 为「不展示」；`display` 无 `/a.md` 块；`/b.md` 为文件名填充（`1|bbb`）。

---

## 自动化回归（同迭代）

```bash
npm test -w @novel-master/core
```

```bash
npm test -w @novel-master/cli
```

（捕获会话时 core 93 / cli 27 用例均已通过。）

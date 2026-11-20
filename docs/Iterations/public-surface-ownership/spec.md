# public-surface-ownership：core 公开面归属收口

> 目标仓库：`D:/worktree/error-channel-slim`（分支 `feat/error-channel-slim`）
> 基线：`p21-nm-deep`（`ac4d0dcbd`）
> 目标 tag：`p22-public-ownership`

## 一、要解决的问题

### 1.1 什么叫「跨域」

三条判据，按优先级：

1. **import 后被二次加工**——不是简单用别域的东西，而是在自己这里把别域的知识重新实现一遍，形成两份会漂移的真相。**本 spec 范围外（前几期已清）。**
2. **re-export 转手**——`export { X } from "../别的域/..."`。如果消费者能直接引用源，中间这层就是多余的。
3. **简单 import**——正常，不动。

### 1.2 现状事实

`packages/core/package.json` 的 `exports` **有两种形态并存**：

**直映内部目录**（不走 `public/`）：
```json
"./common":    "./dist/common/index.js"
"./nmtp":      "./dist/infra/nmtp/index.js"
"./tdbc":      "./dist/infra/tdbc/index.js"
"./sksp":      "./dist/infra/sksp/index.js"
"./sksp-node": "./dist/infra/sksp/node.js"
"./log":       "./dist/infra/log/index.js"
"./stored-config-validity": "./dist/domain/agent/stored-config-validity/index.js"
"./presentation/chat/*":    "./dist/presentation/chat/*"
```

**门面式**（走 `public/*.ts`）：20 个，共 586 个 re-export 符号。

### 1.3 根因

```
infra/tokenizer       没有 exports 条目  →  48 个符号只能从 public/provider.ts 出
infra/llm-protocol    没有 exports 条目  →  13 个符号只能从 public/provider.ts / public/abort.ts 出
```

证据：

```ts
// public/provider.ts:155
export { countTokens, getEncoding, buildCounterScope, ... 共 48 个 } from "../infra/tokenizer/index.js";

// public/provider.ts:158
export type { Interrupt, Outcome } from "../infra/tokenizer/index.js";

// infra/tokenizer/index.ts:74
export type { Interrupt, Outcome } from "../../errors/outcome.js";
```

`Interrupt` / `Outcome` 的唯一实现在 `errors/outcome.ts`，却经过**两级转手**挂到 `provider` 门面下——而 `public/errors.ts` 本来就在装着 `outcome`。

### 1.4 已量化

按「barrel 名 vs 来源域」扫 586 个 re-export，跨域 116 个：

```
48  infra/tokenizer
13  infra/llm-protocol
11  errors
 8  presentation
 6  service/compaction-conditions
 5  domain/depth
 5  domain/character-card
 3  domain/compaction-conditions
 3  common
 3  domain/message-checkpoint
 2  domain/workplace
 2  service/template
 1  × 8（tool / session-run-state / sksp / serialization / message-checkpoint服务 / bootstrap / prompt）
```

consume 侧（不含 `apps/cli`）粗估 1900+ 站点，分布 mobile 882 / desktop 690 / packages 362。

## 二、范围与处置

分三层，**互不重叠**。

### 层 A：给缺出口的 infra 加直映 exports（61 个符号）

照 `./nmtp` / `./tdbc` 的样式，在 `packages/core/package.json` 新增两条：

```json
"./tokenizer": {
  "types": "./dist/infra/tokenizer/index.d.ts",
  "import": "./dist/infra/tokenizer/index.js"
},
"./llm-protocol": {
  "types": "./dist/infra/llm-protocol/index.d.ts",
  "import": "./dist/infra/llm-protocol/index.js"
}
```

然后**删除**这些 re-export（不搬家，直接删）：

| 文件 | 行 | 内容 |
|---|---|---|
| `public/provider.ts` | 155 附近 | 48 个 tokenizer 符号的 re-export 块 |
| `public/provider.ts` | 158 | `export type { Interrupt, Outcome } from "../infra/tokenizer/index.js"` |
| `public/abort.ts` | — | `isAbortLikeError` ← `infra/llm-protocol` |
| `infra/tokenizer/index.ts` | 74 | `export type { Interrupt, Outcome } from "../../errors/outcome.js"` ← **这行是污染的源头，删** |

**`Interrupt` / `Outcome` 的归宿是 `@novel-master/core/errors`**（`public/errors.ts` 已导出 `outcome`）。

### 层 B：指向已有直映出口的 re-export（16 个符号）

这些出口已存在，只需删 re-export，消费者改 import 路径：

| 来源域 | 数量 | 已有出口 |
|---|---|---|
| `errors` | 11 | `./errors` |
| `common` | 3 | `./common` |
| `infra/sksp` | 1 | `./sksp` |
| `infra/serialization` | 1 | ❌ 无 → 归到 `./tokenizer` 还是新建要现场判 |

`infra/serialization/zod-to-json-schema` 只有 `zodToJsonSchema` 一个符号，消费方是 provider 域。**处置：留在 `public/provider.ts`**（它服务于 provider 的 schema 转换，不是独立域）。

### 层 C：39 个业务域符号逐个裁决

已裁决完毕，**执行者照表做，不再判断**：

| 门面 | 符号 | 处置 |
|---|---|---|
| `public/chat.ts` | `formatStatusChipLabel`、`formatStatusChipLabelFromAttachment`、`rollbackConfirm`、`RollbackConfirmDescriptor`、`RollbackConfirmKind`、`RollbackMode`、`summarizeToolInput`、`toolCallSummary` | **撤**（8 个）。`./presentation/chat/*` 通配出口已存在 |
| `public/chat.ts` | `resolveVfsToolFilePath` | **撤**。外部零消费 |
| `public/compaction.ts` | 全部 14 个（`domain/depth` 5 + `domain/compaction-conditions` 3 + `service/compaction-conditions` 6） | **留**。depth 是 compaction 的实现细节，对外语义就是 compaction |
| `public/format.ts` | `StreamTokenSource` | **移**到 `public/session-run-state.ts` |
| `public/session-fs.ts` | `isRollbackVfsDegradableError`、`isRollbackRevisionBackfillRequiredError`、`readRollbackRevisionBackfillMissingPaths`、`RollbackOptions` | **移**到 `public/message-checkpoint.ts` |
| `public/skills.ts` | `BUILTIN_SKILL_NAMES` | **留**。skills 域概念，`bootstrap` 只是定义处 |
| `public/smart-sort-rule.ts` | `CompiledSmartSortRule` | **留**。是 `compileSmartSortRule` 的返回类型，不能拆 |
| `public/smart-sort-rule.ts` | `formatSortTupleForDisplay` | **撤**。外部零消费 |
| `public/vfs.ts` | `CHARACTER_CARD_MAX_INPUT_BYTES` | **留**。mobile `vfs-character-card.service.ts` 在用 |
| `public/vfs.ts` | `CHARACTER_CARD_MAX_TOTAL_CONTENT_BYTES`、`CHARACTER_CARD_MAX_SINGLE_FILE_BYTES`、`CHARACTER_CARD_MAX_FILE_COUNT`、`MdTree` | **撤**。外部零消费 |
| `public/workplace.ts` | `createTemplatePullService`、`TemplatePullService` | **撤**。外部零消费 |
| `public/workplace.ts` | `layoutHasWorkplace` | **撤**。`public/prompt.ts` 已导出（重复） |

**小计：留 17、撤 17、移 5。**

**核心原则：撤优先于搬。** 大部分「被塞进别的门面」的符号，正确处置是撤掉（对外零消费），不是搬家。新建 `public/*.ts` 门面在本 spec 里**只有一处**（`public/session-run-state.ts` 和 `public/message-checkpoint.ts` 都已存在，是移进去）。

## 三、明确不做

- **不改 `apps/cli`**。已从 workspaces 移除（见 §四步骤 0），它红不红与门禁无关。
- **不做「re-export 全清零」**。`public/` 门面本 spec 保留——它是对外契约的稳定层，让内部可以自由重构而不破坏外部。只有明确跨域的才删。
- **不动 `public/` 之外的东西**。`domain/`、`service/`、`infra/` 的内部 import 一律不改。
- **不改任何运行时逻辑**。全部改动只有三种形态：加 `exports` 条目、删 re-export 行、改 import 路径。**一行实现都不许动。**
- **不新建 `public/character-card.ts`**。评估过：`CharacterCardImportPort` 零外部消费，不需要独立门面。
- **不碰 `presentation/chat/*` 通配出口**。

## 四、执行步骤

### 步骤 0：把 `apps/cli` 从 workspaces 摘除

```json
// 根 package.json
"workspaces": ["packages/*", "apps/desktop", "apps/mobile"],
```

同时删除 `"link:cli"` 脚本。

验证：`npm run test` 输出里不再有 `> @novel-master/cli test`。

`package-lock.json` 会有大改（去掉 cli 整棵依赖树），必须一并提交。

### 步骤 1：加两条 exports（层 A 前提）

见 §二 层 A。改完 `npm run build -w @novel-master/core` 确认 dist 里出现 `dist/infra/tokenizer/index.js` 与 `dist/infra/llm-protocol/index.js`。

### 步骤 2：删 re-export（层 A + B + C）

按 §二 三张表逐行删。**删完不要立刻改消费者**——先让编译红暴露全部待改站点。

### 步骤 3：迁移消费者 import

按包分片，每片列出死的文件清单（禁止「你自己找」）：

| 分片 | 范围 | 注意事项 |
|---|---|---|
| S1 | `apps/desktop/src` | — |
| S2 | `apps/mobile/src` | — |
| S3 | `packages/tokenizer-driver-node/src` | **改完必须重建 dist** |
| S4 | `packages/tokenizer-driver-rn/src` | **改完必须重建 dist** |
| S5 | `packages/cloud-sync-driver-s3/src`、`packages/sksp-*/src` | — |

**dist 重建由主代理串行做，不进分片**（并行 build 会互相污染）。

### 步骤 4：收敛

- 根 `typecheck`（14 个 workspace，cli 已摘除）
- core / desktop / mobile 全量测试
- `check-style --all` 三段 + `dup-gate`

### 步骤 5：归属检测器（新增）

写 `scripts/check-public-ownership.mjs`：

```
对每个 packages/core/src/public/<name>.ts：
  提取所有 export { X } from "<相对路径>"
  按路径判来源域（domain/<d> / service/<d> / infra/<d> / errors / common / presentation / bootstrap）
  与 <name> 不符则报 MISPLACED
退出码：有任何 MISPLACED 则 1
```

**例外表**（写进脚本，带理由）：

| 门面 | 允许的来源域 | 理由 |
|---|---|---|
| `compaction` | `domain/depth`、`domain/compaction-conditions`、`service/compaction-conditions` | depth 是 compaction 的实现细节 |
| `vfs` | `domain/character-card` 的 `CHARACTER_CARD_MAX_INPUT_BYTES` | 角色卡经 VFS 导入 |
| `skills` | `bootstrap` 的 `BUILTIN_SKILL_NAMES` | 定义处 vs 语义域 |
| `provider` | `infra/serialization` | 服务于 provider 的 schema 转换 |
| `smart-sort-rule` | `domain/workplace` 的 `CompiledSmartSortRule` | compile 函数返回类型 |

接入 `check-style.mjs` 或独立门，二选一。

### 步骤 6：打 tag

全绿后 `git tag p22-public-ownership`。任一项不达标按真实状态提交，tag 用 `p22-public-ownership-partial` 并在 commit message 写明哪项没过。

## 五、验收判据

```
1. 根 typecheck                          exit 0（14 workspace）
2. packages/core 全量测试                exit 0
3. apps/desktop 全量测试                 exit 0
4. apps/mobile 全量测试                  exit 0
5. check-style --all  signatures/inline/methods 三段 PASS
6. dup-gate                              新增 0
7. check-public-ownership.mjs            exit 0
8. public/ 跨域 re-export 计数           116 → 0
9. public/ 总 re-export 符号数           586 → 493（删 61 层A + 15 层B + 17 撤；层C 的移动不减总数）
10. exports 子路径数                     32 → 34（+tokenizer +llm-protocol）
```

**第 8 条的算法**（执行者自己跑一遍确认，不要信 spec 里的数）：

```bash
node -e '
const fs=require("fs"),path=require("path");
const dir="packages/core/src/public";
let bad=0;
for(const f of fs.readdirSync(dir).filter(x=>x.endsWith(".ts"))){
  const barrel=f.replace(/\.ts$/,"");
  const src=fs.readFileSync(path.join(dir,f),"utf8");
  const re=/export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"([^"]+)"/g;
  let m;
  while((m=re.exec(src))){
    const seg=m[2].replace(/^\.\.\//,"").split("/");
    const domeg=["errors","common","presentation","bootstrap"].includes(seg[0])?seg[0]:seg[1];
    if(domeg!==barrel) bad+=m[1].split(",").length;
  }
}
console.log("misplaced:",bad);
'
```

## 六、风险

| 风险 | 缓解 |
|---|---|
| `tokenizer-driver-*` 改 import 后 apps 测试假红（dist 未重建） | 主代理串行重建 dist 后再跑 |
| `package-lock.json` 与 `node_modules` 不一致 | 步骤 0 后跑一次 `npm install` 并提交 lock |
| 删 re-export 时漏了 `export type` 变体 | 步骤 2 后用 `npm run typecheck` 全量暴露 |
| 某个符号其实有外部消费但我们没查到（因为用了别名 import） | 步骤 5 的检测器只查 re-export 归属，不查消费；消费漏了会在步骤 4 编译红暴露 |
| `presentation/chat/*` 通配出口的消费者改成深路径后，未来 presentation 重构会破坏外部 | 接受。这是「直映」模式的固有代价，与 `./nmtp` 一致 |

## 七、不处理项（记录，不排期）

- `test` 目录里的短码调用（已在前几期清）
- `apps/cli` 的 327 个站点（停止维护）
- `public/` 20 个门面是否要合并（如 `kkv` / `session-kkv` 只有 2-3 个符号）——**下一轮再议**
- `TEST_ONLY` B 桶 15 个 + D 桶 5 个
- C2 的 27 个 prefs 门面（114 调用点）

# D1-02：L2 算法 & 复杂度

> 角度横扫结果。readonly，不改任何代码，不宣布 ready。本报告负责两个维度：运行时算法（时间/空间复杂度、边界条件、热路径重复计算）和构建时复杂度（增量失效、prebuild 链重复劳动）。包依赖归 L3，CI 配置归 L10，文档承诺归 L11，这里只在不可避免时挂一句指向。

## 元信息

- 角度：L2 算法 & 复杂度
- 模式：readonly 全局横扫
- 输入：D0-1 代码地图、D0-2 文档索引、`lens-L2-algorithm.md` 指导文档
- 估算方法：阅读核心算法源码后按数据结构 + 循环结构人工推导，n 取典型场景量级而非最坏输入

## 结论

整体来说，这个仓库的**算法纪律是有的，但有几个藏在「看起来对」里的真实热点**，且测试保护明显不足，叠起来才是 L2 视角下的真正风险。

最值得先看的是 **`user-vfs-save-mapping` 的行级 diff + anchor 扩展**。它走的是朴素递归 diff，再叠一层 `expandAnchorHunk` 的半径扩展搜索，最坏情况下能退化到 O(n³)，而 n 是文件行数，用户编辑 1000+ 行的 markdown 模板时就会卡。这段代码还属于「用户手动保存触发」的体验路径，一旦卡住就是肉眼可见的卡顿。其次是 **`SqlTemplateParser` 的逐次重解析**——每个 repo 方法调用都重新 parse 模板字符串成 AST 再丢弃，没有任何缓存。单条 SQL 模板很短，单次成本不高，但 agent runner 一轮里会跑几十次 repo 查询，重复劳动累加起来不小，而且修复成本极低（加个 `Map<template, AstNode>` 就行）。

**compaction-conditions 反而没问题**。Phase 0 把它列为「小代码大复杂度」的极端案例（412 行/5 迭代），但实际看代码，触发逻辑是 OR 复合 + tokenRatio / visibleFloor 两条独立 trigger，每次评估最多各跑一遍，复杂度是 O(可见消息数)。5 次迭代重构换来的是**架构上的简化**，不是算法上的复杂化。这里要担心的是**触发语义是否和 spec 一致**（属于 L4/L8），不是复杂度。Phase 0 的「高迭代密度 = 算法复杂」在这条线上不成立。

**vfs 路径与 revision 这一块**复杂度本身可控（normalize 是 O(路径段数)、revision ref-count 是 O(revision 数)），但**串行 await 的循环太多**：`deleteVfsPrefix`、`decrementLiveRefsUnderScope`、`repairRefCounts` 全是「for 循环里一条条 await repo 调用」，每条都是一次 DB round-trip。复杂度上算 O(n) 没错，但常数是「一次 SQLite 往返」，目录下 100 个文件就是 100 次串行往返。这部分和 L1（数据模型/批量 API）紧密相关——根因是 repo 没提供批量操作，逻辑层只能循环。

**构建维度的问题更系统、影响面更大**。`packages/core` 的 build 脚本是 `tsc --build tsconfig.json --force && tsc-alias`——`--force` 直接把 `tsconfig.base.json` 里配的 `composite: true / incremental: true` 全废掉，每次都全量重编。更要命的是 mobile 的 `prestart` / `preandroid` / `preios` 各自会触发 5 个 workspace 的 build（core + s3 + sksp-android + tdbc-driver-rn + tokenizer-driver-rn）外加 webview 构建，连跑 `npm run pretest` 然后 `npm run android`，core 会被强制全量重编至少两次。desktop 的 `prebuild` 同样顺序触发 6 个 workspace build，没有任何 incremental 缓存复用。**TS 项目引用体系完全没建立**：base 里写了 `composite: true`，但 core 自己的 `tsconfig.json` 没有 `references`，各子包也没配 references，所以 `--build` 实际只是把 core 当单 project 处理，跨包增量复用根本没生效。

整体边界条件覆盖**差**。regex（727 行核心 + 3 测试）、vfs revision diff、prompt-engine 这几个算法核心区都缺测试保护，意味着任何边界 bug（空输入、单元素、超大输入）都很可能在 CR 之后才被发现。

## 角度 × 模块矩阵

下面按算法热点模块逐段展开。每段会标出复杂度估算、n 的典型量级、边界条件评估和热路径判定。

### compaction-conditions（触发条件算法）

**判定：算法本身健康，没有 L2 级别问题。**

读 `triggers/composite-trigger.ts` + `token-ratio.trigger.ts` + `visible-floor.trigger.ts` + `service/.../create-compaction-condition-evaluator.ts`：

- `CompositeConditionTrigger.shouldTrigger` 是短路的 OR——子 trigger 命中即返回，**最多遍历 2 个 trigger**（factory 里只塞 tokenRatio 和 visibleFloor 两个）。
- `VisibleFloorTrigger` 只 `session.list()` 拿长度比较，复杂度 O(visible messages)，n 典型 10–200。
- `TokenRatioTrigger` 走 `resolveCurrentPromptTokens`，先查 `sessionApiPromptTokenCache`（O(1) 命中），miss 时跑完整 prompt 计数，这是真正的成本中心。
- evaluator 每次调用重建 trigger 对象（`triggersFromConditions` 里 `new TokenRatioConditionTrigger(...)`）——但这是几个对象的常量开销，可忽略。

**真正的隐性成本**：tokenRatio 命中时，token 计数（`countPromptLlmInput` → 完整 prompt 序列化 + heuristic counter）会和 `applyLlmRegexChannelToVisible`、`renderPromptLlmInput` 在同一轮 agent loop 里**重复跑**（详见「重复计算」发现）。这部分算法是 O(消息数 × 平均文本长度 ÷ CHARACTERS_PER_TOKEN_RATIO)，但**单次评估触发**没问题，**多次评估**才是问题。

边界条件：`visibleFloor` 严格大于才触发，单条消息场景安全；`tokenRatio` 在 `contextWindow == null` 时直接返回 false，安全。**没有除零、没有 NaN 风险**。

Phase 0 把这里列为「5 迭代 → 算法复杂度热点」，从 L2 角度看是个**误判**：5 次迭代改的是「trigger 在哪一层组装」（agent 内置 → 全局策略 → 事件总线驱动），是**架构**变化不是**算法**变化。这条线索交给 L3/L5。

### vfs-path-mapper（路径解析枢纽，42 次引用）

**判定：复杂度健康，但存在重复 normalize 的隐性成本。**

`vfs-path-mapper.ts` 全部是 O(路径段数) 的字符串操作。`normalizePath`（`repositories/impl/normalize-path.ts`）是单次 split + 单次栈遍历，O(path 段数)，n 典型 <10。

值得记的**重复计算**：`toPhysicalPath` 先调 `resolveLogicalPath`（内部 `normalizePath`），再调 `assertLogicalPathAllowed(scope, normalized)`——而 `assertLogicalPathAllowed` 又重新调一次 `resolveLogicalPath(logical)`（line 56）。**同一次 `toPhysicalPath` 调用里 `normalizePath` 跑了两次**。`resolveLogicalPath` 自身还会再 `normalizePath` 一次。整体三层调用栈，最坏情况下 normalize 跑 3 次。单次 normalize 是 O(段数 <10)，叠加影响小，所以标 B。但因为这函数被 vfs 几乎所有模块引用（42 次），如果未来路径变深（嵌套层级 >50），叠加影响会放大。

边界条件：`normalizePath` 对 `..` 越界抛 `vfsInvalidPath`，对空字符串抛错，对非 `/` 开头抛错——**边界覆盖到位**。

### regex（727 行核心 + 3 测试）

**判定：算法本身是 O(消息 × 规则 × 文本)，但测试保护严重不足。**

`apply-regex-rules.ts` 的实际成本结构（结合 agent-runner.ts 的调用方）：

```
applyRegexChannelToVisible(messages, rules, channel, depthMap)
  └─ messages.map(m => applyRegexToMessageContent)
       └─ mapTextBlocks → applyRegexRules(text, rules, ctx)
            └─ for rule of rules: text.replace(rule.pattern, replacement)
```

- 整体复杂度：O(M × R × L)，其中 M = 可见消息数（典型 10–200）、R = 启用规则数（典型 1–10）、L = 文本块平均长度（典型 100–5000）。
- 单次调用是合理的。**热路径风险**在于调用频次：`agent-runner.ts` 的 `applyLlmRegexChannelToVisible` 在**每一轮 agent loop** 都重新跑一遍——多轮对话累计下来成本线性增长。

**真正的算法风险点：`compileRegexRule` 在 `resolveActiveCompiledRules` 里被每次调用**。`resolveActiveCompiledRules` 走 `config.listCompiledRulesForGroup(activeGroupId)`——这个名字看起来是缓存的，但需要核实配置层是否真的缓存了编译产物（如果每次都 `new RegExp`，每轮 agent loop 都重编译所有规则）。**未能在本次扫描内核实 `RegexConfigService` 的实现**，列为待交叉线索（open question）。

边界条件：空规则数组 → 原样返回；空消息 → 不进入循环；role 不匹配 → continue；depth 不匹配 → continue。**没有崩溃风险**。但因为只有 3 个测试覆盖 727 行核心，**边界用例几乎肯定有遗漏**——比如 `startDepth === 0 && endDepth === 0`（只匹配最末消息）、role 既不是 user 也不是 assistant（system / tool 消息）的边界，没看到测试覆盖。

### tokenizer（含 heuristic counter + session cache）

**判定：核心算法 O(n) 健康，但有空间泄漏和重复计数。**

`heuristic-token-counter.ts`：`countMessages` 单次遍历累加字符长度，再除以 `CHARACTERS_PER_TOKEN_RATIO (3.35)`——O(总字符数)，正确。空消息数组返回 0（`Math.ceil(0/3.35)`），不返回 NaN，**边界安全**。

`count-prompt-llm-input.ts` 把计数委托给 NMTP driver registry，未注册时回退到 `countPromptLlmInputHeuristicOnly`——后者调 `serializePromptLlmInput`（完整序列化整个 prompt 为字符串）+ `registry.heuristic.countText(serialized)`。**序列化整个 prompt 每次都重跑**，但这是回退路径，正式部署应注册真实 driver。

`session-api-prompt-token-cache.ts` 是**模块级 `Map<sessionId, entry>`**：
- 命中时 O(1)，但 `clear` 只在「completed∧pick / FAILED / 失效」call-site 触发。
- **空间复杂度问题**：长跑进程（特别是 desktop/mobile 端常驻）会**累积所有曾经访问过的 sessionId**，没有 LRU、没有上限、没有跨会话清理。典型 mobile 用户开过 100+ session 后，这个 Map 持有 100+ entry（每个 entry 几十字节，绝对量不大），但**模式上是泄漏**。属于 L2 空间复杂度 + L5 生命周期管理交叉。

`context-window-map.ts` 是顺序 substring 规则数组，O(规则数 × id 长度)，规则数 <10，忽略不计。

### prompt-template（macro-scan + macro-render，递归解析）

**判定：O(n) 线性扫描，安全；但 `MacroAction` 类型字段语义有冗余。**

`macro-scan.ts` 用 `indexOf("{{", i)` + `indexOf("}}", open+2)` 线性推进 cursor，**整段只扫一遍**，O(template 长度)。`{{/*...*/}}` 注释、`{{.path}}`、`{{$.key}}` 三类 action 各自 O(段内长度)。整体 O(n)，n 典型 <2000（prompt block 文本）。

`macro-render.ts` 把扫描出的 actions 用 `slice + out +=` 串接——这里有个**微性能问题**：`out += template.slice(...)` 在长模板上会触发 JS 字符串的「写实复制」，理论上是 O(n²) 的字符串拼接。但 V8 在拼接次数 <10³ 时会走 flattened string 优化，实际 n <2000 时不会观察到问题。标 C。

边界条件：空模板直接返回；未闭合 `{{` 抛 `INVALID_YAML`；空 macro action 抛错；unknown root field 抛错——**覆盖完整**。

一处冗余：`parseAction` 内部返回的 MacroAction 把 `start: openOffset, end: openOffset`（即 start === end）填了，然后 `scanMacroActions` 调用方又 spread 重写 `{ ...action, start: open, end: close + 2 }`。读起来会让人疑惑「为什么先填再覆盖」，**不会出错但语义混乱**，建议清理——属于 L9 死代码/可读性。

### sql-template（938 行，parser + evaluator + tags）

**判定：单次调用复杂度可控；最大的问题是「无 AST 缓存，每次重 parse」，外加 foreach + new Function 的双重成本。**

#### parse 阶段（`parser.ts`）

- `parseNodesUntilClose` 在 `parseChildren` 外层循环里被反复调用，每次调用都 `template.indexOf("<", i)` + `indexOf("#{", i)` + `indexOf("${", i)` 三个 indexOf 从当前 pos 重新扫到结尾。
- 在「文本和绑定交替密集」的模板里，每次调用 indexOf 都扫到 string 末尾，**最坏 O(N²)**（N = 模板长度）。但 SQL 模板典型 <1KB、绑定数 <20，实际可观察成本 <1ms。标 B（典型场景 n <100）。
- `isTagStart` 在循环里还做 `OPEN_TAG_RE.test(slice)`，每发现一个 `<` 都 slice + regex 一次，常数项偏大但同上。

#### evaluator 阶段（`evaluator.ts`）

- foreach 标签对每个 item push 一个新 scope frame（`pushScope` 拷贝整个 stack 数组），然后递归 evaluate 子节点——O(items × children)，对典型 `IN (?, ?, ?)` 列表（items <100）安全。
- **真正的隐性成本在 `expression.ts` 的 `evaluateTest`**：每次 `if` / `when` 求值都 `new Function("__ctx__", "return (...)")`——**每次都重新编译 JS 表达式**。在 foreach 体内嵌 `<if test="...">` 时，求值次数 = items × 1，每次都是 `new Function` + 字符串 normalize + identifier rewrite + Proxy 包装。这是真实的重复劳动，但因为 SQL 模板的 if 通常不在 foreach 内（典型 if 是判空集合），n 通常 = 1。**如果用户写出 `<foreach><if>` 组合**就会感受到。标 B。

#### 重复 parse（最大问题）

`SqlTemplateParser.parse`（`index.ts`）每次都：

```ts
parse(template, params) {
  const ast = this.parser.parse(template);   // ← 每次重 parse
  const evaluator = new TemplateEvaluator(this.placeholder);
  return evaluator.evaluate(ast, params);
}
```

模板字符串是源码里的常量（看 `sqlite-vfs-entry.repository.ts` / `sqlite-message-checkpoint.repository.ts` 等），**但每次调用 repo 方法都从头 parse 一遍**。每个 repo 持有自己的 `parser` 实例，但没有 `Map<template, ast>` 缓存。

agent runner 一轮里 list messages + load checkpoint + insert revision 等几十次调用，全部重 parse。单次成本 <0.5ms，累积 50 次就是 25ms 量级的纯浪费——**热路径上的重复劳动**。修复成本极低（在 `SqlTemplateParser` 内加 `private astCache = new Map<string, AstNode[]>()`），收益直接。标 A。

边界条件：
- `parseAttributes` 对无属性的标签头且 header.trim() 非空时报 `MALFORMED_TAG`——边界保护到位。
- foreach 对空 collection 直接 break，安全。
- `${}` raw interpolation 在 index.ts 的 docstring 里明确标注「SQL injection 风险，仅在受信任值上使用」——这是**有意设计**，但属于 L8 安全角度，这里只标一句「已在代码注释中告警」。

### message-checkpoint（rollback + diff）

**判定：算法 O(n) 健康，但有多处串行 await round-trip；anchor 解析有冗余 O(n) 查找。**

`resolve-rollback-anchor.ts` 的 `resolveRollbackAnchorMessage`：

```ts
messages.find(m => m.id === anchorMessageId)   // O(N)
↓ 若是 assistant with tool_use
resolveToolResultsMessageId(messages, anchor)  // O(N) 扫描后续消息，每条建 Set
↓ 找到结果
messages.find(m => m.id === resultsId)         // 又一次 O(N)
```

整体 O(N)，N = session 消息数，典型 <200。**正确且不会崩**，但同样的 messages 数组被遍历了 3 次，且没有索引（`Map<id, message>`）。如果未来 session 体量增长到 10⁴，会感知到。标 B。

边界条件：anchor 不存在 → undefined（调用方需检查）；assistant 无 tool_use → 直接返回 anchor；tool 结果未配齐 → 返回 anchor。**没有崩溃路径**。

`restore-mutating-path-heads.ts` 的 `restoreDirectorySnapshot`：

- 第一次 `list(path, {recursive: true})` 拿 currentFilePaths，建 `Set` —— O(N)
- 遍历 currentFilePaths 查 snapshotPaths.has → O(N)
- 遍历 snapshot.files 调 `resetHeadToVersion` —— O(M) 个 await round-trip

整体 O(N + M) 算法复杂度 + O(M) DB round-trip。这里**round-trip 才是瓶颈**（M 个文件 = M 次串行 SQLite 调用），但属于 rollback 一致性必要串行（L4 角度）。

### vfs revision diff & tree-copy

**判定：算法本身健康；同上，问题在「循环里串行 await」。**

`vfs-tree-copy.ts` 的 `copyVfsTree`：

- 目录批量：`listDirectoryPathsUnderPrefix` + `findExistingPaths`（批量）+ `batchInsertDirectoryEntries`（批量）——**已经批量化**，O(N)。
- blob 文件快路径：`findExistingBlobHashes` + `findExistingPaths` + `batchInsertFileEntriesWithHash` ——**已批量化**。
- 慢路径（部分 blob 缺失）：fallback 到逐条 `findByPath + insert/update`——O(N) round-trip。这是 fallback，正常路径不走。
- 无 hash 文件：`scanContents` 一次批量读 + 逐条 `insert/update`——**N 次串行 round-trip**。如果 scope 下无 hash 文件较多，这一步会很慢。但 entry_id 化后大部分文件应该有 hash，慢路径触发概率低。

`deleteVfsPrefix`：

```ts
const sorted = [...entries].sort((a, b) => b.path.length - a.path.length);
for (const entry of sorted) {
  await repo.delete(scopeKey, entry.path, { recursive: false });
}
```

- 排序 O(N log N) 为了「先删子节点再删父节点」——逻辑正确。
- N 次串行 DELETE，每次一次 round-trip。N = 目录下所有 entry 数，典型 <50。

`revision-ref-count.ts`：

- `repairRefCounts`：扫 checkpoint pointers + live heads 建 expected Map，然后 `for key of keys: await repairRefCountFloor`——**O(keys) 串行 round-trip**。
- `decrementLiveRefsUnderScope`：`for head of liveHeads: await adjustRef`——**O(heads) 串行 round-trip**。

这两条都是**事务一致性必要**的串行（ref_count 调整必须按顺序），不是算法缺陷。但 L1 角度可以问「repo 能否提供批量 adjustRefCount」——这是数据模型层的优化空间，不属于 L2。

### user-vfs-save-mapping（行级 diff + anchor 扩展）★ 重点

**判定：最坏 O(n³) 的真实热点，n = 文件行数，用户编辑大文件时卡顿来源。**

`computeLineChangeRegions` + `diffRecursive`（lines 89–138）：

```ts
function diffRecursive(oldLines, oStart, oEnd, newLines, nStart, nEnd, regions) {
  // 头尾 trim 共同行（O(n + m)）
  // 然后：
  for (let oi = os; oi < oe; oi++) {
    for (let nj = ns; nj < ne; nj++) {
      if (oldLines[oi] === newLines[nj]) {  // 找到首个匹配
        regions.push(...);
        diffRecursive(...);  // 递归
        return;
      }
    }
  }
  // 全不匹配 → push 整段
}
```

- 单次调用：双循环 O((oe-os) × (ne-ns)) = O(n × m)。
- 递归最坏深度 K = min(n, m)（每次只匹配一行就递归），所以**总复杂度 O(K × n × m) = O(n² × m)**，最坏 O(n³)。
- 典型场景（行 100–500）通常在头尾 trim 阶段就快速收敛，实际可观察成本 <100ms。
- **退化场景**：用户大幅改写文件（保留少量分散的相同行）——如全文重排 + 局部保留——递归深度和双循环宽度同时放大。1000 行文件可能跑数秒。

更糟的是 `expandAnchorHunk`（lines 140–169）：

```ts
const maxRadius = Math.max(baselineLines.length, savedLines.length);  // = N（行数）
for (let radius = 0; radius <= maxRadius; radius++) {
  for (let before = 0; before <= radius; before++) {
    // 拼接 oldString + newString
    // countOccurrences(baseline, oldString)  ← O(|baseline| × |oldString|)
  }
}
```

- 外层 radius 循环 N 次，内层 candidates `(radius+1)` 个，总 candidates 数 O(N²)。
- 每个 candidate 跑 `countOccurrences`，在 baseline 全文上 indexOf——O(|baseline 字符数| × |oldString|)。
- 整体 `expandAnchorHunk` 是 **O(N² × |baseline chars|)**，对 1000 行文件（约 50KB 文本）= 10⁶ × 5×10⁴ = 5×10¹⁰ 操作——**会肉眼卡死**。
- 每个 region 都跑一次 `expandAnchorHunk`，所以整体 = O(regions × N³) 级别。

触发路径：用户在 VFS 编辑器里改文件并保存 → `mapUserSaveToToolUses`。**不是 agent loop 热路径**，但是**用户操作热路径**——一次保存卡 10 秒会直接被感知。

修复方向（不属于本报告范围，只标方向）：换成 Myers diff 或 Histogram diff（O(N × D)，D = edit 距离，典型场景 D 很小）；anchor 扩展可以二分半径而不是线性扫描。

边界条件：
- baseline == content → `noop`，安全。
- baseline == null → `write` 新文件，安全。
- baseline 完全不同（无共同行）→ 单个 region 覆盖全文，`anchor.oldString === baseline` 命中 `write` fallback，安全。
- **隐患**：极大文件（10⁴ 行+）会卡到超时——但目前 vfs 文件多为 markdown 模板，n 通常 <1000。

### vfs-grep（行扫描 + 上下文）

**判定：O(rows × lines × regex) 合理；invert + contextLines 模式有内存放大。**

`grepContents`（lines 128–189）：

- 主循环 `for row of rows: for line of lines: matcher.lineMatches(line)`——O(R × L × regex)，R = 文件数、L = 每文件行数。
- regex 模式下 `matchColumns` 用 `regex.exec` 循环找所有命中——O(line × regex)，标准。
- literal 模式用 `indexOf` 推进——O(line × needle)，正确。
- 正常模式安全。

**invert 模式的内存放大**：每个不匹配的行都 push 一条 VfsGrepMatch，且每个 match 都 `buildExcerpt`（slice + join，O(contextLines)）。如果 pattern 是「啥都不匹配」的退化情况（比如 invert + 一个全文件都匹配的 pattern），每个文件每行都生成一条 match——O(R × L) 条结果，每条带 O(contextLines) 字节。在「grep 一个大目录且 invert 命中爆炸」时会**结果集 O(N × L) 内存占用**。这是用户输入触发的退化场景，标 B。

边界条件：空 rows → 空 matches；空 content → 单行空字符串；空 needle → literal 模式返回 0 命中——**安全**。

## 构建时复杂度（扩展维度）

诶～构建这边问题比运行时算法那边系统得多。逐条列：

### 构建发现 1：core build 用 `--force` 强制全量重编 ★ A

**文件**：`packages/core/package.json` line 108

```json
"build": "tsc --build tsconfig.json --force && tsc-alias -p tsconfig.json"
```

- `tsconfig.base.json` line 15–16 配了 `composite: true` + `incremental: true`。
- `--force` 直接无视 `.tsbuildinfo`，**每次都全量重编 core 全部 ~30K 行 TS**。
- `tsc-alias` 紧跟着也全量重写路径别名（无增量）。
- 没有任何代码注释或 commit 记录解释「为什么需要 --force」。Phase 0 推测「可能是为了规避某个增量编译 bug」，但**未找到佐证**，按指导文档判定为「无明确理由的 --force」——**A 级**。

修复方向：去掉 `--force`，让 incremental + tsbuildinfo 生效。如有历史 bug 应以注释固化原因。

### 构建发现 2：TS 项目引用体系完全未建立 ★ A

**文件**：`packages/core/tsconfig.json`、各 `packages/*/tsconfig.json`

- `tsconfig.base.json` 配了 `composite: true`——这是 TS 项目引用的前提。
- 但 core 的 `tsconfig.json` **没有 `references` 字段**，各 driver 包（tdbc-driver-rn / tokenizer-driver-rn / sksp-*）的 tsconfig 也没 `references` 指向 core。
- 因此 `tsc --build` 只是把每个包当独立 project 处理，**跨包增量复用根本没生效**。core 改一行，下游 driver 包不会通过 tsbuildinfo 知道「core 没变就不用重 build」——它们的 `prebuild` 链强制重跑。
- Phase 0 指导文档里写「core 配了 composite:true 但 build 用 --force 抵消」——**部分正确，更深的问题是 references 根本没建**。

修复方向：在 core / 各 driver 的 tsconfig 里建立 `references` 拓扑；用 `tsc --build`（不带 --force）从根驱动整个构建图。这会让 mobile/desktop 的 prebuild 链自动跳过未变更的包。**A级**。

### 构建发现 3：mobile prebuild 链顺序触发 5+1 次 build，core 在一次工作流里被反复重编 ★ A

**文件**：`apps/mobile/package.json` lines 14, 19, 27–29

```json
"pretest":  "npm run build -w @novel-master/core -w @novel-master/cloud-sync-driver-s3 && npm run build:webview",
"prebuild": "npm run build -w @novel-master/core",
"prestart": "npm run build -w @novel-master/core -w @novel-master/cloud-sync-driver-s3 -w @novel-master/sksp-android -w @novel-master/tdbc-driver-rn -w @novel-master/tokenizer-driver-rn && npm run build:webview",
"preandroid": "...同 prestart... && npm run build:webview:native",
"preios": "...同 prestart... && npm run build:webview:native"
```

- `preandroid` / `prestart` / `preios` 各自触发 **5 个 workspace 的 build** + webview 构建。
- 由于每个 workspace 的 build 是独立 tsc 且 core 用 --force，**每次 `npm run android` 都强制全量重编 core + 4 个 driver**。
- 连跑 `npm run pretest` 然后 `npm run android`：core 被 build 两次、s3 被 build 两次、webview 被 build 两次。**完全没复用**。
- mobile 的 RN 开发循环本身就是高频 `npm run android` 的场景，每次都付全部 5 个包的 build 成本——**这是开发者每日体验的隐性税**。

判定：同一产物在 prebuild 链中被构建 ≥2 次（连跑两个 mobile 命令时），**A级**。

### 构建发现 4：desktop prebuild 链顺序触发 6 次 build ★ B（升级到 A 如连跑）

**文件**：`apps/desktop/package.json` line 9

```json
"prebuild": "npm run build -w @novel-master/core && npm run build -w @novel-master/cloud-sync-driver-s3 && npm run build -w @novel-master/tdbc-driver-better-sqlite3 && npm run build -w @novel-master/tokenizer-driver-node && npm run build -w @novel-master/sksp-windows && npm run build -w @novel-master/sksp-mac"
```

- 6 个 workspace build 用 `&&` 串行触发。`npm run -w` 本身不保证拓扑序，这里靠 `&&` 强制顺序。
- 单独跑 `npm run build` 在 desktop 端，core 全量重编（--force）+ 5 个 driver 各自全量 tsc。
- 但 desktop 的 `predev:electron` 只重 build core（line 17），没有 preandroid 那种叠加效应。所以 desktop 单独标 B。

### 构建发现 5：三套构建管线缓存完全独立，无共享 ★ B

**文件**：core 的 `.tsbuildinfo`（如生效）、desktop 的 `node_modules/.vite`、mobile 的 Metro cache

- core 用 tsc + tsc-alias，缓存是 `.tsbuildinfo`（且被 --force 失效）。
- desktop 用 vite + esbuild + rollup（dev 用 vite/esbuild，build 用 rollup，preload 用 esbuild bundle）——缓存是 `node_modules/.vite`。
- mobile 用 Metro（RN bundler）+ webview 容器（webview 那侧走 `scripts/build-webview.mjs`，从 mobile/package.json 看像是 esbuild）——缓存是 Metro 的 `__generated__` / webview 输出。
- **三套缓存互不复用**：同一段 core 代码在 desktop dev 启动时被 vite/esbuild 编一次，在 mobile start 时被 Metro 编一次，在 core build 时被 tsc 编一次。
- 这是 monorepo 多端共存的天然代价，单点优化空间有限——但意味着**任何 core 改动至少触发 3 次独立编译**。标 B（属于「三套管线缓存独立无法共享」的典型情形）。

### 构建发现 6：端侧 dev/watch 覆盖不完整 ★ B

**文件**：各 package.json 的 `dev` 脚本

- core 有 `dev: tsc -p tsconfig.json --watch`——OK。
- 所有 driver 包都有 `dev: tsc -p tsconfig.json --watch`——OK。
- desktop `dev` 用 `concurrently` 跑 `dev:vite` + `dev:electron`，但 `predev:electron` 只 build core 一次（不 watch）。**改 core 后 desktop 端不会自动重 build core**，需要手动重跑。
- mobile `start` 只是 `react-native start`（Metro），**prestart 强制重 build core + 4 driver**——没有 watch，每次改 core 都要手动 `npm run prestart`。
- mobile 的 metro.config 通常会配 watch，但 watch 的范围只覆盖 RN 源码，**core 改动需要手动触发 prestart**——这是 mobile 端开发体验差的根因之一。

判定：端侧无 watch 且依赖 core 改动，**B 级**。

### 构建发现 7：monorepo.md 承诺的 vfs:* 脚本在根 package.json 中不存在 ★ → L11

**文件**：`docs/monorepo.md` lines 20–22 vs 根 `package.json` lines 11–32

monorepo.md 承诺：

```
| `npm run vfs:watch` | watch 同步，默认镜像 `./tmp/mirror` |
| `npm run vfs:push` / `vfs:pull` | force 全量 push/pull |
| `npm run vfs:sync -- …` | 自定义参数 |
```

根 `package.json` **完全没有** `vfs:watch` / `vfs:push` / `vfs:pull` / `vfs:sync` 任何一个。这是文档承诺与实现漂移，不属于 L2（属于 L11 文档角度），**这里只标记事实并指向 L11**。

## 发现清单

按严重度排序：

| # | 严重度 | 模块 | 文件 | 复杂度 / n | 说明 |
|---|-------|------|------|-----------|------|
| F1 | **A** | sql-template | `infra/sql-template/index.ts` | 每次 parse O(N)，N=模板长度 <1KB | `SqlTemplateParser.parse` 无 AST 缓存，每次调用都重 parse 模板字符串。热路径上 agent runner 一轮跑几十次 repo 方法 = 几十次重复 parse。修复成本极低。 |
| F2 | **A** | user-vfs-save-mapping | `domain/vfs/logic/user-vfs-save-mapping.ts` | diffRecursive 最坏 O(n²×m)；expandAnchorHunk 最坏 O(N²×baseline_chars)；n=行数典型 100–1000 | 朴素递归 diff + 半径扩展搜索，最坏退化为 O(n³) 量级。用户编辑大文件保存时卡顿来源。建议换 Myers diff。 |
| F3 | **A** | 构建-core | `packages/core/package.json` | 每次 build 全量 ~30K 行 TS | `--force` 强制全量重编，抵消 `composite/incremental`。无注释解释原因。 |
| F4 | **A** | 构建-项目引用 | `packages/*/tsconfig.json`、`tsconfig.base.json` | - | `composite:true` 在 base 里配了，但各包没有 `references`，跨包增量根本不生效。 |
| F5 | **A** | 构建-mobile | `apps/mobile/package.json` | 5 个 build + webview 每次 `preandroid`/`prestart`/`preios` | 连跑 mobile 命令时 core 被重编 ≥2 次，无 incremental 复用。 |
| F6 | **B** | vfs-path-mapper | `domain/vfs/logic/vfs-path-mapper.ts` | normalize O(段数 <10) | `toPhysicalPath` 在单次调用链里 normalize 跑 3 次（resolveLogicalPath + assertLogicalPathAllowed 内部再 resolve）。被 42 处引用，叠加放大。 |
| F7 | **B** | tokenizer-cache | `infra/tokenizer/logic/session-api-prompt-token-cache.ts` | 空间 O(sessionId 数) 无上限 | 模块级 Map 无 LRU、无跨会话清理，长跑进程累积所有 sessionId。模式上是泄漏。 |
| F8 | **B** | sql-template-evaluator | `infra/sql-template/expression.ts` | new Function 每次 O(表达式长度) | `evaluateTest` 每次都 `new Function` 重新编译 JS，foreach + if 组合时放大。n 通常 = 1，退化场景放大。 |
| F9 | **B** | sql-template-parser | `infra/sql-template/parser.ts` | 最坏 O(N²)，N=模板长度 | parseNodesUntilClose 每次调用 indexOf 都从头扫到尾。模板 <1KB，实际成本 <1ms。 |
| F10 | **B** | regex-engine | `domain/regex/logic/apply-regex-rules.ts` + service 调用方 | O(M × R × L)，M=消息数 R=规则数 L=文本长度 | agent runner 每轮重跑全量 regex apply，无增量。配合 727 行 / 3 测试的保护缺口，风险叠加。需核实 `RegexConfigService.listCompiledRulesForGroup` 是否真缓存了编译产物。 |
| F11 | **B** | message-checkpoint-anchor | `domain/message-checkpoint/logic/resolve-rollback-anchor.ts` | O(N)，N=消息数 <200 | 同一 messages 数组被遍历 3 次（find + scan + find），无 Map 索引。 |
| F12 | **B** | vfs-grep | `domain/vfs/logic/vfs-grep.ts` | 内存 O(R × L)，R=文件数 L=行数 | invert + 全匹配 pattern 时结果集爆炸，每行 + context 都 push。 |
| F13 | **B** | vfs-batch-roundtrips | `domain/vfs/logic/{vfs-tree-copy,revision-ref-count}.ts` 等 | O(N) 串行 await round-trip | deleteVfsPrefix / decrementLiveRefs / repairRefCounts / copy 慢路径全是循环里逐条 await repo。复杂度正确，但常数是 SQLite 往返。L1 可考虑批量 API。 |
| F14 | **B** | 构建-desktop | `apps/desktop/package.json` | 6 个 build 串行 | prebuild 链 6 个 workspace build，无 incremental 复用。单独 B，连跑升级为 A。 |
| F15 | **B** | 构建-缓存独立 | 三套管线 | - | tsc-alias / vite+esbuild / Metro+webview 缓存互不复用。多端共存天然代价。 |
| F16 | **B** | 构建-watch | desktop/mobile package.json | - | desktop `dev:electron` 不 watch core；mobile `start` 不 watch core/driver，core 改动需手动 prestart。 |
| F17 | **B** | regex-compile | `domain/regex/logic/resolve-active-regex-rules.ts` | 待核实 | 每轮 agent loop 调用，需核实 `listCompiledRulesForGroup` 是否缓存 `new RegExp`。若未缓存则每轮重编译所有规则。 |
| F18 | **C** | prompt-template | `infra/prompt-template/macro-render.ts` | 字符串拼接 O(n²) 理论 / V8 优化下 <10³ 拼接无感 | `out += slice(...)` 模式，长模板理论 O(n²)。实际 n <2000 无感。 |
| F19 | **C** | macro-scan | `infra/prompt-template/macro-scan.ts` | - | `parseAction` 返回的 start/end 被调用方 spread 重写，先填再覆盖，语义混乱。属 L9。 |
| F20 | -（指向 L11） | 文档漂移 | `docs/monorepo.md` vs 根 `package.json` | - | monorepo.md 承诺的 `vfs:watch/push/pull/sync` 脚本在根 package.json 中不存在。详见 L11。 |

## 待交叉的线索

L2 视角看到的问题，有几条会和别的角度产生交叉或冲突，下面把这些线索留出来，等跨角度比对时一起评。

### → L1（数据模型 & 持久化）

**F13 的真正根因在数据模型**。vfs 串行 round-trip 不是算法层的错——`VfsEntryRepository` / `VfsRevisionRepository` 没有暴露 `batchDelete` / `batchAdjustRefCount`，逻辑层只能循环 await。如果 L1 评估后认为可以加批量 API，L2 这条自然消解；如果 L1 认为批量会破坏事务语义，L2 维持 B 并标注「事务约束」。

同样 `SqlTemplateParser` 无缓存（F1）也和 L1 有关：repo 持有 parser 实例但没有 AST 缓存，是数据访问层的实现选择。L1 可能更关心「prepared statement 复用」这一层。

### → L3（架构 & 依赖）

**F4 的项目引用缺失**本质是 monorepo 架构问题。core 和 driver 包之间没有 TS references，等于「workspace 拓扑」和「TS 增量拓扑」是两套独立系统。L3 评估包依赖图时应该顺手评这个。

**compaction-conditions 的「5 迭代」**也是 L3 范畴——L2 看下来算法没问题，5 次迭代改的是 trigger 的组装层级（agent 内置 → 全局策略 → 事件总线），这是**架构演化**不是**算法演化**。Phase 0 把它判为 L2 热点是误判，L3 才是正确的角度。

### → L5（并发 & 异步）

**vfs 的串行 await**（F13）有可能被 L5 反驳——「这些串行是事务一致性必要的，不能并发」。如果 L5 这么说，L2 接受降级，但仍然认为「事务必要 ≠ 不能批量」，repo 层提供批量 API（在单次事务里发多条 SQL）和「并发执行」是两回事。

**tokenizer cache 的清理时机**（F7）也涉及 L5——缓存失效目前靠 call-site 显式 `clear`，如果有并发场景未覆盖，L5 会发现 race。

### → L7（测试 & 可测性）

**regex / sql-template / vfs revision diff 测试稀疏**——这三块在 L2 视角下都有「看起来正确但缺保护」的算法。L7 应该评估：
- regex 727 行 / 3 测试，边界（空 / 单消息 / startDepth=0 / 非 user-assistant role）几乎肯定没覆盖。
- sql-template parser 的 O(N²) 退化需要大输入压力测试，目前没有。
- user-vfs-save-mapping 的 O(n³) 退化需要 10⁴ 行输入压力测试，目前没有。

### → L8（API 稳定性 & 安全）

**sql-template 的 `${}` raw interpolation**——index.ts 的 docstring 明确告警 SQL injection 风险。L2 不展开，留给 L8 评估「调用方是否真的只传可信值」。

### → L10（基建一致性）

**tsconfig 选项统一性**——base 配了 `composite/incremental/noUnusedLocals/noUnusedParameters`，但 core 自己的 `tsconfig.json` 没显式覆盖也没显式继承 references 配置。如果 L10 评估「所有包 tsconfig 应该共享 references 拓扑」，那 F4 同时是 L10 问题。

### → L11（文档漂移）

**F20 monorepo.md 承诺的 `vfs:*` 脚本不存在**——L2 只标记事实，详见 L11。

## 自评与不确定

这次扫描的**确定结论**：F1（sql-template 无缓存）、F3（core --force）、F5（mobile prebuild 链）、F6（path-mapper 重复 normalize）、F7（cache 泄漏）、F11（rollback anchor 多次遍历）、F13（vfs 串行 round-trip）——这些是直接读源码就能验证的事实。

**高度怀疑但未核实**：
- F2（user-vfs-save-mapping O(n³)）的退化路径需要实际压力测试验证。我的估算基于代码结构推导，真实 V8 字符串/数组操作有隐藏优化可能让最坏情况没那么糟。**建议跑一次 10⁴ 行文件的 diff 实测**。
- F10 / F17 的 regex 编译缓存需要核实 `RegexConfigService.listCompiledRulesForGroup` 的实现——这次扫描没读到那一层。
- F4 项目引用体系的实际效果，需要尝试去掉 `--force` 后实测 build 时间变化。

**未覆盖**：
- vfs-zip 系列我只扫了 central-dir / build，没看 `vfs-zip-validate.ts`（199 行）和 `vfs-zip-path.ts`（162 行）的完整逻辑——这两块如果有正则或递归，可能有遗漏。
- agent-prompt-layout 19 次引用但我没深入读组装逻辑，L3/L6 可能更关心。
- `service/compaction-conditions/impl/` 目录我没展开（只看了顶层 factory），如有编排算法可能需要补扫。

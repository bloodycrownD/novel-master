---
name: nm-code-style
description: novel-master 的代码优化与重构原则。写新代码、重构、内联收敛、错误处理、命名与文件放置、CR 修复时使用。
---

# nm 代码优化原则

写、改、重构代码前先过一遍这份清单。目标是**让代码更短、更直、更少层**，不是把代码摆得更"整齐"。

## 1. 先内联，再判断

- **类里不写 private 方法**，一律并进公开方法。抽 private 对 agent 没有收益，只是多一层跳转；内联后才能看清顺序能否合并、条件是否重复、中间结构能否省掉。
- 类里只留 private 字段承载状态。
- 模块级单点调用的私有函数同样内联；`z.preprocess` 的回调、`transform`/`toWire` 这类只挂一次的映射也直接写成箭头。
- 只有**被多处复用的纯比较/纯映射**才留模块级私有函数（如 `sameToolUse`）；内联会制造三份 `JSON.stringify` 时，留函数是对的。
- 内联后重点检查四件事：重复条件、可合并的连续步骤、只为下一步服务的中间变量、恒真/恒假的形状守卫。

先例：`DoomLoopDetector` 内联三个 private 方法后，发现轨迹已裁到恰好一个窗口，`slice(-crossRoundWindow)` 是多余复制；`validateAgentDefinition` 内联后，`prompts` 的对象/数组检查被证明冗余，直接要求 `persist`/`dynamic` 是数组即可。

## 2. 一行写完

- **函数签名、调用参数列表写在一行**，不按参数拆行。参数多到一行放不下，先减少参数或缩短参数名，而不是换行。
- `new XxxError("CODE", "message")` 也写一行，不要为了"可读"把 code 和 message 拆成两行。
- 简单表达式不要拆成多行；只有长条件确实需要分段时才换行，且换行后每段要能独立读懂。
- 导入语句能一行就一行。

## 3. 错误进 Either，不抛

- 域逻辑/校验函数返回 `Result<T, E>`（`Result.ok` / `Result.err`），函数体内不 throw。
- 在**边界**统一决定是否抛：runner、service、tool、IPC handler、CLI 命令处写 `if (!result.ok) throw result.error;`。边界之外不再复制判断。
- 不要给错误工厂再包一层：`agentDoomLoop()` 这种只有 `new AgentError` 的 wrapper 直接删，调用点写 `new AgentError(...)`。
- 不要为了"统一"把本来有 code 的域错误包成 `Error` 或丢失 code；要么保留域错误，要么迁到统一 `AppError` 注册表，别造中间壳。
- zod 的 `preprocess` / `transform` 是例外：它的失败协议就是 throw，没有 Result 通道。Result 边界放在 `decode` 和校验函数，不要在 schema 里硬塞 Result 再 throw 回去。

## 4. 不为抽象而抽象

- **单行转手 wrapper 删掉**：函数体只有 `return f(x)`、没有策略/校验/前缀/默认值/依赖隔离时，直接把 `f` 暴露给调用点。先例：`resolveSavedModelId`、`generateAgentRunId`、`mergeAgentDefinitionPatch` 都被删过。
- 只有一个消费者的通用类型机器不要上：为 `AgentDefinition` 写递归 `MergePatch<T>` 是标准 RFC 写法，但这里只有一个模型，显式 patch interface 更好读。判断标准是**消费者数量 + 模型稳定性**，不是"标准不标准"。
- 包装层只有在增加**策略、校验、默认值、协议转换，或隔离不稳定依赖**时才值得保留。
- 判据看"它认识谁"，不看"谁在调它"：逻辑跟数据模型走。合并规则认识 `AgentDefinition`，就放 `domain/agent/logic`；tool 只是入口，不是语义所有者。反过来，只有 tool 认识的 schema/action 分发不要塞进 domain。
- YAGNI：没有生产者的错误码、没有调用方的别名、没有第二消费者的抽象，直接删，不占号不占文件。

## 5. 通用工具与命名

- 通用谓词/纯工具统一放 `packages/core/src/common/`，经 `@novel-master/core/common` 给三端共用。发现**第二份**就地实现时就收敛，不等到第三份。
- 文件名按**类别**起（`guards.ts`、`merge-patch.ts`），不要按单个函数起（`is-record.ts`）。下一个小工具应该能并进已有类别文件。
- 模块名要能看出职责；`is-record.ts` 这种抽象名会让下一个守卫又新开一个文件。

## 6. 类型与不可达守卫

- 校验不可信输入（LLM JSON、YAML、IPC）时，先把字段读进 `const x: unknown = ...` 再判断；直接对已声明类型判断，TS 收窄后会把运行时守卫判成 unreachable。
- 不要用类型断言掩盖运行时形状；断言只用于"边界已验过"的地方。
- 去掉冗余形状检查：要求 `obj.a` / `obj.b` 都是数组，已经能拒绝字符串、数组、数字，不必再先查 `typeof obj === "object"` 和 `Array.isArray(obj)`。

## 7. 验证节奏

- 改完先跑 typecheck，再跑相关测试，再 lint 改动文件；不要只跑一个就宣布完成。
- 改了公共导出或 `dist` 消费方，重建 core 并跑 package-exports 快照。
- 提交前看 `git diff --stat` 和关键 diff，避免整文件 CRLF/LF 换行噪音；换行噪音单独还原，不要混进逻辑提交。

## 交付前 30 秒检查

- 只调用一次的 private / 模块级函数，内联了吗？
- 有没有 `return f(x)` 这种单行转手 wrapper？
- 签名、调用参数、错误构造，是不是还有多行？
- 域逻辑里还有 throw 吗？throw 是否都收在边界？
- 这个 Result 真的有失败分支吗，还是为了"统一"硬加的？
- 有没有第二份通用工具/守卫/纯映射该进 `core/common`？
- 改完 typecheck、相关测试、lint 都跑了吗？

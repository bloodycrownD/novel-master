---
date: 2026-10-24 18:52
title: core errors 的 Either 脚手架已落地（对象风格），迁移等用户指令
keywords: either, Result, packages/core, errors, 迁移, 判别联合, 序列化, revive
abstract: 用户要把 packages/core/src/errors 的错误体系往 Either 风格迁移。第一版自由函数脚手架被用户质疑后，按用户拍板重写为对象风格（Ok/Err 类 + 原型方法链 + Result.ok/err/revive 静态入口 + toJSON/revive 跨进程序列化），16 个域别名删除。迁移本身仍等用户指令。附带三轮概念讨论（自由函数 vs 方法、方法挂载与序列化/JVM 方法区、静态方法与命名空间）。
---

user:
D:\Dev\Js\novel-master\packages\core\src\errors 看下这个代码，我想改成 either 风格，不过你也不需要大规模重构，先生成对应 either 类型和方法吧，我来告诉你怎么迁移。

assistant:
读完了 errors 下全部 16 个文件，都是「code 判别码 + Error 子类 + isXxxError 守卫 + 工厂函数」的统一形态。第一版只新增两个文件：`src/errors/either.ts`（Result 判别联合 + ok/err + 自由函数组合子 + attempt 桥接 + 16 个域别名）和 `test/errors/either.test.ts`。关键设计：纯数据判别联合免疫 src/dist 双实例 instanceof 陷阱；err/attempt* 保证 error 原对象透传（端上按 code 分类依赖原对象）。

user:
你不要迁移哈，你本次只是新增代码，我之后告诉你怎么迁移。

assistant:
好的，本轮确实只新增了上述两个文件，现有 16 个错误文件与各处导出一律未动。迁移怎么做等用户指令。

user（追加，对脚手架设计的质疑）:
你这写的啥啊，toError 函数干什么？这种不一般是对象方法吗？为什么搞成函数的？类似的其他方法也是，我觉得这些函数作为方法或静态方法，都比独立函数好。而且给这么多类型重命名干什么？有意义吗？

assistant:
三个点分别回应，未改代码等拍板：① toError 是迁移胶水（catch 到的 unknown 归一为 Error，Error 原对象透传）；② 自由函数的辩护：纯数据可序列化、结构类型免疫双实例、仓库 errors/ 工厂与 common/ 工具本就全是模块级自由函数；但也承认方法链（neverthrow 形态）是主流偏好，判据是 Result 出不出进程；③ 16 个域别名承认 YAGNI 超前。

user（追加，概念追问：方法挂载与序列化）:
我懂了，result 挂不挂方法，取决于是否序列化？不像 java 那样，方法区和数据区是一起的？

assistant:
方向对，精确化两点：①判据是「会不会经过丢原型的通道」（Electron IPC 的 structuredClone、RN 桥的 JSON、worker postMessage、src/dist 双模块实例），不出进程方法就没事；②Java 其实方法和数据也不在一起——方法字节码在 metaspace，对象只有类指针+字段；Java 原生序列化「感觉一起」是协议带类名、接收端按名加载本地类重新接上；Java 走 JSON 同样只剩数据，Jackson 反序列化就是手动 revive。JS 没有按类名自动重接的机制，要重接得在边界自己写 reviver。

user（追加，拍板对象风格）:
我还是喜欢对象风格，出进程我也还是希望是对象，自己弄一个专门的序列化方法吧。话说非得双端重写吗？core 代码不能引用吗？

assistant:
按用户拍板重写为对象风格（双端问题：不需要双端重写，desktop/mobile 都依赖 @novel-master/core，revive/toJSON 放 core 两端 import 同一份；storage-failure-bypass 测试注释里有双端字面量收敛进 core 的先例）。either.ts 第二版：

- `Ok<T,E>` / `Err<T,E>` 两个类，组合子挂原型链式调用（map/mapErr/andThen/orElse/unwrapOr/unwrapOrElse/match/mapAsync/andThenAsync）；Ok 侧故意不用的参数用 `_fn` + `void _fn;` 消 no-unused-vars 警告。
- 入口 `Result.ok` / `Result.err` / `Result.revive`：const 与 type 同名双声明（值空间静态工厂 + 类型空间联合）；ok/err 对侧类型参数填 never 保内联推断——但 err 侧直接链式调用时 T 钉死为 never，需函数签名/注解先提供 T（unwrapOr 的 fallback 会变成 never）。
- 分支收窄用 `r.ok` 字段（类实例 + 字面量判别字段支持判别联合收窄），不再需要 isOk/isErr。
- 跨进程序列化：`toJSON()` 是 JSON.stringify 钩子兼显式入口，产出 `ResultWire` 线上形态（error 经 serializeErrorPayload 展开 name/message + own 可枚举字段，解决裸 Error 过 JSON 变 `{}`）；`Result.revive(raw)` 落地端重建带方法的实例，error 侧带 name/message 的产物重建为 Error 并回填 code 等字段（结构守卫照常可用），非 Result 形状返回 null。
- 16 个域别名已删；attempt* 家族与 toError 保留为模块级函数（工厂/桥接性质，与仓库 vfsNotFound 等工厂风格一致）。

验证：src typecheck 过、eslint 0 告警、test/errors 17/17 过（含 JSON 往返后 isVfsError 守卫可用、structuredClone 丢方法后 revive 复活两组牙齿）。tsconfig.test.json 全量跑有既有跨包报错（tokenizer TS6307 等），either 相关为零。注意：用户 IDE（IntelliJ）会把文件自动格式化成 4 空格，与仓库 2 空格风格不一致。迁移仍等用户指令。

user（追加，概念追问：静态方法）:
为什么 ts 不使用静态方法呢？静态方法不是处理命名空间的好办法吗？你还说只有缺点？

assistant:
修正上一轮的绝对化表述：TS 大量使用静态/命名空间方法（Object.keys、Array.from、Promise.all、JSON.parse、Math.*），而且 either.ts 的入口 Result.ok/err/revive 本来就是挂在 const 命名空间对象上的静态形态。标准库自身的分界线是「造新东西用静态、对实例做事用原型方法」（Array.from vs arr.map、Promise.all vs p.then）。当时反对的只是「把组合子做成静态 Result.map(r,f) 当折中」：它等价于带命名空间的自由函数，不能链、实例上点不出补全，对用户想要的链式风格无增益（fp-ts/Effect 用模块函数+pipe 证明该形态可行，只是不满足链式诉求）。另有具体技术原因：Result 是 Ok|Err 的联合类型别名，TS 不允许类型别名挂静态（namespace 只能与 class/function/enum 合并，不能与 type alias 合并），故静态入口只能放 const 对象（Math 形态）。

user（追加：改吧 + 问 Result<T,E> | null）:
改吧，另外 Result<T, E> | null 这种是干什么的？

assistant:
把 attempt* 与 toError 全部收进 Result 命名空间并顺手更名：attemptSync→Result.attempt、attemptSyncAs→Result.attemptAs、attemptAsync/attemptAsyncAs/toError 同理加 Result. 前缀，模块级自由函数版删除（不留双 API）。测试同步改名，验证 typecheck/eslint/17 条测试全过。

`Result<T, E> | null` 是 Result.revive 的返回类型：revive 吃 unknown（对端跨进程发来的裸数据），只做形状校验；「对端发来的根本不是 Result 形状」无法伪造成成功或失败，也不能凭空造 T/E，所以按 TS「可能没有」层的可空语义返回 null（if (r == null) 即协议违例分支），与 strictNullChecks 强制调用方先处理 null；备选是 throw（协议违例快速失败）或嵌套 Result<Result<T,E>, Error>（Result 套 Result），权衡后选可空。

user（追加，质疑 revive 的 unknown 场景）:
没懂，什么场景需要判断 unknown 是不是 either？我觉得没有这个场景。

assistant:
承认用户判断成立（YAGNI 收口）。真正出现 unknown 的只有两类：①Electron IPC/worker 落地端（TS 类型运行时不存在，接收方拿到 unknown，必须有一步转成 typed Result）；②持久化回读（Result 存进 KKV/文件/事件日志再读回，磁盘数据可能是旧版本/损坏）。同版本内部通道且不落盘 ⇒ null 分支是死代码。

按此收口：`revive<T,E>(wire: ResultWire<T>): Result<T,E>` —— 边界处一次类型断言（IPC 载荷的标准处理），去掉 `| null`；形状违约（断言撒谎）抛 "Result.revive 收到非 Result 线上形态" 快速失败，不伪造成功也不把协议问题伪装成业务失败；刻意不加 safeRevive（等真出现持久化/跨版本降级需求再说）。测试同步改：JSON 往返用 `as ResultWire<number>` 断言、structuredClone 同理、null 用例改成 assert.throws。验证 typecheck/eslint/17 条全过。

user（追加，准备迁移，问 agents-bundle.schema）:
我准备迁移了，然后看了下 AgentError，然后发现了 apps/cli/src/agent/schemas/agents-bundle.schema.ts 这个代码，它是干什么的？

assistant:
解释：这是 CLI 侧多 agent bundle 交换格式（agents.yaml/json）的 Zod schema，根形状 `{schemaVersion: 1, agents: {[agentId]: entry}}`（strict），entry 含 prompts/model/runtime.maxSteps/tools.allow|deny/description/mode，导出 schema、AgentsBundleDocument 类型、isAgentsBundleDocument 廉价形状嗅探。两个消费点：import-export.ts（整包导入导出 registry）与 load-agent-config-file.ts（单 agent 配置 vs bundle 分流，bundle 需 --agent-id）。关键结论：这条链路的错误是 ConfigDecodeError（parseText/decode/encode）加下游 AgentConfigError（registry.upsert→validateAgentDefinition），**不是 AgentError**——AgentError 只用于运行时（DOOM_LOOP/UNSUPPORTED_PROVIDER/MAX_STEPS/NOT_FOUND/FAILED），所以先迁 AgentError 时此文件不受影响。

user（追加，确认使用范围）:
没看懂，就是说这两个是给 cli 用的？其他地方没用？

assistant:
全仓搜证实（排除 node_modules/dist/docs）：`agentsBundleDocumentSchema`/`isAgentsBundleDocument`/`AgentsBundleDocument` 的源码引用只有 apps/cli 三处——src/agent/import-export.ts（schema+type）、src/config/load-agent-config-file.ts（schema+嗅探）、test/agents-bundle.test.ts；desktop/mobile/packages 零引用，也无同名功能的其他实现（importAgentsFromFile/exportAgentsToFile/agentsBundle 亦零命中）。dist 命中只是 CLI 自身编译产物，docs 命中是历史 spec 与 memoria。结论：这是 CLI 专属的批量 agent 交换格式，不属 core 公共 API，改它只影响 CLI 与其测试。

assistant:
全仓搜证实（排除 node_modules/dist/docs）：`agentsBundleDocumentSchema`/`isAgentsBundleDocument`/`AgentsBundleDocument` 的源码引用只有 apps/cli 三处——src/agent/import-export.ts（schema+type）、src/config/load-agent-config-file.ts（schema+嗅探）、test/agents-bundle.test.ts；desktop/mobile/packages 零引用，也无同名功能的其他实现（importAgentsFromFile/exportAgentsToFile/agentsBundle 亦零命中）。dist 命中只是 CLI 自身编译产物，docs 命中是历史 spec 与 memoria。结论：这是 CLI 专属的批量 agent 交换格式，不属 core 公共 API，改它只影响 CLI 与其测试。

user（追加，拍板删除 + 建分支）:
那删除了吧，cli 也不需要这些功能。新建一个开发分支吧。删除成本高吗？主要是保持 core 的干净，cli 之后会整体清理掉，cli 能编译通过就行，cli 无人使用。

assistant:
新建分支 `feat/core-errors-either`（沿用 feat/* 惯例），完成 bundle 功能删除，成本低（3 删 3 改 + 4 个测试调整，全在 apps/cli，core 零改动）：
- 删除 `src/agent/schemas/agents-bundle.schema.ts`（连带空的 schemas 目录）、`src/agent/import-export.ts`、`test/agents-bundle.test.ts`；
- `registry-commands.ts` 移除 `import`/`export`/`migrate` 三个子命令（migrate 读 `<home>/agents.yaml` 也是 bundle）及 access/join/resolveNovelMasterHome/import-export 导入，帮助文案同步；
- `commands.ts` 分发与 usage 去掉三个子命令，`loadAgentFromConfig(agentConfigPath, agentId)` 改单参，registry 未命中文案从「run nm agent import」改为「run nm agent list」；
- `load-agent-config-file.ts` 只保留单 agent 解析（bundle 分支与 agentId 参数删除）；
- 三个用 `nm agent import` 播种最小 agent 的 e2e（chat-smoke/preferences/session-rollback）改为 `nm agent create --name ...`，12/12 通过；`agent-registry-e2e` 删掉 E1/E2/E4 三条 bundle 用例后 3/5 通过，剩余 E3（compaction schema invalid_value）与 N-P0-03-3（nm-boot 日志为空）为既有红，与本次删除无关。其他 CLI e2e（agent-smoke/cli-context/prompt-tokens/agent-config）的空 registry 建会话失败也是既有红（这些测试没播种 agent，session create 在空 registry 必失败），CLI 无人使用按用户要求只保证编译。
验证：apps/cli typecheck exit 0、eslint exit 0。

user（追加，拍板 Either 通用语义）:
（贴出 attemptAs 代码）这里，我希望 either 是一个通用的，所有 error 都会被包装成 either。

assistant:
按通用语义收口：删除 `Result.attemptAs` / `Result.attemptAsyncAs`（它们的核心行为是「守卫不命中就重抛」，与「所有 error 都进 Either」直接矛盾；若强行把未命中的错误标成 E 则是类型撒谎，下游按 E 读 code 会拿到 undefined）。保留 `Result.attempt` / `Result.attemptAsync` 作为唯一桥接：任何抛出物（域错误、基础设施故障、字符串、裸对象）一律进 Err，**从不重抛**；域守卫改在拿到 Err 之后按需收窄（`if (!r.ok && isVfsError(r.error))`）。测试牙齿换成「基础设施故障与字符串抛出物也必须落进 Err」+「桥接层从不重抛」。验证 17/17、typecheck/eslint 全过。另发现 revive 被外部改成 `if (wire.ok)`/`if (!wire.ok)`（会把形状违约吞成 Err(undefined)），已恢复 `=== true/false` 精确判别；若该改动是有意的需再与用户确认。

user（追加，问 IDE 简化布尔是否有 bug）:
ide 的简化布尔是有 bug 吗？我以为它是对的。。。

assistant:
IDE 建议本身不是 bug：`if (x === true)` → `if (x)` 在 x 被类型保证为 boolean 时完全等价。它默认「类型是真的」，而 revive 恰好在验证「类型可能撒谎」——边界数据必须做比类型更严格的运行时判别。真值判断会把 true/false/garbage 三态塌成两态（undefined、字符串、裸对象都落进 !ok 分支，伪造业务失败）。经验法则：外部/边界数据（IPC、JSON、DB、磁盘、用户输入）用精确比较；本进程类型产出的可信值用真值判断无妨。已把 revive 的内部视图收窄为 `{ ok?: unknown; value?: unknown; error?: unknown }` 再 `=== true/false` 判别，并加注释说明「简化布尔表达式」在此不适用——unknown 与 true 比较后 IDE 不会再建议简化。验证 17/17、typecheck/eslint 全过。

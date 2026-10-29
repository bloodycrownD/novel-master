---
date: 2026-10-25 10:23
title: 通用 isRecord 收敛到 core/common/guards（16 处重复清零）
keywords: isRecord, isJsonObject, common, guards, @novel-master/core/common, 去重, 通用谓词, webview 白名单
abstract: 用户指出 merge-patch 里的 isJsonObject 不该就地写，通用函数应放 core 的 common/util 包，否则必然重复。搜索证实 core 与 mobile 共 16 处同义守卫（15 个 isRecord + 1 个 isJsonObject）。已新增 packages/core/src/common/guards.ts（通用判断工具，不按单函数命名）并从 common barrel 导出，全部替换；webview 白名单补 common/guards.js；core typecheck、280 项相关测试、mobile tsc、webview 门 B/C、定向 lint 全绿。
---

## 本轮

user:
这种通用函数你不能这么写，你应该在 core 搞一个 util 或 common 包，或者在 package 中搞个大的 common/util 包，否则这种逻辑很容易重复写，事实上也确实重复写了。

assistant:
先搜重复面：`function isRecord/isJsonObject/isPlainObject` 命中共 16 处，语义完全一致（`typeof object && !== null && !Array.isArray`），分布在 core 的 llm-protocol 解析器、chat content/schema、tool logic 与 mobile 的四个 webview bridge，外加 `merge-patch` 自己的 `isJsonObject`。

落地：
1. 新增 `packages/core/src/common/guards.ts`（通用判断工具，按类别命名而不是按单个函数命名），唯一实现 `isRecord(value: unknown): value is Record<string, unknown>`；不校验原型，因为调用方都是解析 JSON 后读字段。序列化/格式化等类别另开同层模块，不往 `guards.ts` 堆。
2. `packages/core/src/common/index.ts` 导出 `isRecord`，经既有 `@novel-master/core/common` 子路径给 desktop main/renderer/mobile 共用；core 内部统一从 `@/common/guards.js` 引。
3. 删除全部 16 处就地定义，替换为 import；mobile 四个 bridge 从 `@novel-master/core/common` 引。
4. webview 依赖门 B 白名单补 `common/guards.js`（chat-transcript 经 composer-draft schema 传递引入）。
5. 把规则写进 `AGENTS.md` 编码风格与 `docs/apm/RULE.md`：通用谓词/纯工具函数放 `core/common`，发现第二处就地实现时先收敛，不允许业务文件里再养一份。

验证：core typecheck、280 项相关测试（common/chat/tool/llm-protocol/package-exports）、mobile `tsc -p tsconfig.build.json`、webview 门 B/C、core 定向 eslint 全绿；core dist 已重建并清掉旧 `is-record.*` 产物。

user:
`/is-record.ts` 这个名字太抽象了，弄个通用些的名字，比如什么判断工具序列化工具，以后其他类似工具也可以写到这个文件。

assistant:
按类别改名为 `common/guards.ts`，`isRecord` 只是第一个成员；模块头注释写明「只放输入 unknown、输出类型收窄或布尔的小函数，序列化/格式化另开同层模块」。同步改 barrel、11 个 core 内部 import、webview 白名单；mobile 侧从公共 barrel 引，不受影响。复跑 typecheck、280 项测试、mobile tsc、webview 门 B/C、lint，全绿。

判据：一行函数最容易「顺手再写一份」，所以判断标准不是「短不短」，而是「第二处出现没」。出现即收敛到 `core/common`，业务文件里只留 import；文件名按类别（guards / merge-patch / …），不按单个函数名。

## 2026-10-29 追加：单函数文件按类别归并（18 → 13）

user:
我更新了下代码格式，然后就是这里面一些文件只有一个导出函数，这些文件能不能合一合？（指 `packages/core/src/common`）

assistant:
先探明引用面：三端全部走 barrel `@novel-master/core/common`（无深路径穿透），硬耦合只有 webview allowlist 的逐文件精确匹配与 core 内部约 26 处 `@/common/xxx.js` 别名导入。按类别归并：

- `encoding.ts` ← base64.ts + utf8.ts（字节/编码类，TextEncoder 惰性单例随迁）
- `error.ts` ← error-text.ts + normalize-yaml-error.ts + normalize-smart-sort-import-error.ts（错误→文案归一层，tdbc 导入深度不变）
- `release.ts` ← compare-app-versions.ts + excerpt-release-notes.ts（更新检查/发布域）
- `json.ts` 扩容 ← merge-patch.ts（applyMergePatch 本就是 JSON 语义）
- 保留 guards/text/coerce/file/xml/i18n/format-token-count/usage-stats-format（本身即类别宿主或多导出）；函数体逐字搬移，barrel 重写后对外符号集不变，desktop/mobile 消费面零改动。

坑①：`npm run clean` 只删 dist 不删 `packages/core/tsconfig.tsbuildinfo`，`tsc --build` 据陈旧 buildinfo 判「未变更」跳过发射，dist 只剩本轮触达文件的传递闭包（domain 只出 7/20 个子目录）——症状是 dist-artifacts / X4 dist 守卫红。修法：删 tsbuildinfo 再全量 rebuild。以后 clean rebuild 一律连 tsbuildinfo 一起删。

坑②：core 测试套的 T-S5 DST 归桶（`usage-stats.service.test.ts`）与 C2-3 copy 事务两条在本轮改动前就红（stash 验证基线），与归并无关，挂账待修。

验证：core typecheck + 全测（仅上述 2 条既存红）、desktop 654/654 + typecheck、mobile 两套 tsc + build:webview（allowlist 同步 `common/utf8.js`→`common/encoding.js`）+ 全套 jest 与基线完全一致（7 条既存红 = `presentation/chat/attachment-chip.js` dist 解析，1 条 AppState flake 单跑即绿）。用户 4 空格格式化与仓库 prettier（2 空格）冲突，保留用户格式未擅改，已上报。check-style 触达面 findings 均为既存（character-card-import 的 DEAD 类型、zlib-accelerator OOP_CANDIDATE），非本轮引入，未处理项见交付报告。

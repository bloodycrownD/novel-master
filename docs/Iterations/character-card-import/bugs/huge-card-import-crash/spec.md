---
date: 2026-09-07
agile_trace: true
---

# huge-card-import-crash 实现规格（SPEC）

## 根因 / 方案摘要

崩溃分两段：

1. **导入段**：角色卡导入链没有任何体积/条目上限。巨型输入在 JS 堆同时存在多份全尺寸拷贝——`fs.readFile(path, 'base64')` 整段 base64（≈1.33×N）→ `atob` binary string + Uint8Array（峰值 ≈3.3×N）→ PNG chara 段逐字符拼接 → 整棵 `JSON.parse` → op-sqlite 绑定写入——触发原生 OOM（Hermes 堆/LMK），任何 try/catch 拦不住，进程直接死亡。
2. **重启段**：导入事务给导入目录补 `ruleEnabled: true` 默认规则并清掉 prompt 缓存；重启后 scope 自动选回会话，token 标签计算对工作区启用文件逐个 `vfs.read` 全文（header 档位也是先整读再截 front matter）并拼接巨型字符串 → 再 OOM，崩溃循环。

方案＝两道闸门（对齐 ZIP 导入已有的 32MB/5000 上限心智）：

- **A 导入闸门（防新增）**：core `importFromBytes` 解析前按输入字节数拒收；md 树生成后、写库事务前三闸（条目数/单文件/总量）拒收，零写库；mobile 在文档选择器落地本地拷贝后先 `stat` 预检体积，超限不进整读。
- **B 读取侧降级（救存量）**：workplace 上下文组装（`loadOrFillFileCache`）在全文读取前先轻量探测 content 大小（只查长度不拉正文），超限文件返回占位文本、不读全文、不写 file_cache；探测失败保守回退原路径。

## 变更点清单

| # | 位置 | 变更 |
|---|------|------|
| 1 | `packages/core/src/errors/character-card-errors.ts` | 错误码联合类型新增 `TOO_LARGE` |
| 2 | `packages/core/src/domain/character-card/logic/character-card-limits.ts`（新增） | 阈值常量（输入 48MB / 总量 32MB / 单文件 8MB / 条目 5000 / blob 折算闸 2MB）+ `utf8ByteLength`（TextEncoder 优先，Hermes 兜底按 UTF-16 码元手数，代理对 4B / lone surrogate 3B，与 TextEncoder 一致） |
| 3 | `packages/core/src/domain/character-card/logic/validate-md-tree-limits.ts`（新增） | 三闸纯函数，超限抛 `TOO_LARGE`（中文报错带实际值与上限值） |
| 4 | `packages/core/src/service/vfs/impl/character-card-import.service.ts` | `importFromBytes` 输入闸（解析前）；`import()` Phase A 后调用三闸（事务前，零写库） |
| 5 | `packages/core/src/public/vfs.ts` | 导出限制常量（allowlist 快照同步更新） |
| 6 | `apps/mobile/src/services/document-io.ts` | `pickAndReadBytes` 新增可选 `maxBytes` + `buildTooLargeError`（错误类型由业务域注入，不反向依赖）；`stat` 超限抛错不进整读，stat 失败容错放行 |
| 7 | `apps/mobile/src/services/vfs-character-card.service.ts` | 角色卡侧注入 `CHARACTER_CARD_MAX_INPUT_BYTES` 与 `TOO_LARGE` 错误构造（与 core 同阈值双保险） |
| 8 | `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts` + `vfs-entry.port.ts` + `model/vfs-content-size.ts`（新增） | `findContentSizeByPath`：内联遗留行 `SELECT length(content)`（字符数）；content store 行回退查 `vfs_content_blob.byte_len`（压缩字节），与真实读取路径的 content_hash 优先顺序对齐 |
| 9 | `packages/core/src/service/vfs/impl/vfs.service.ts`、`revision-aware-vfs.service.ts`、`scoped-vfs.service.ts`、`internal-vfs.port.ts`、`domain/vfs/ports/vfs-service.port.ts` | `findContentSize` 经服务链透出 |
| 10 | `packages/core/src/domain/workplace/logic/load-or-fill-file-cache.ts` | cache miss 后先探测：内联行按字符数对比单文件上限；blob 行按压缩字节对比 2MB 折算闸（8MB/4，宁可误占位不漏放行）；超限返回「（文件过大，已跳过，约 N 字符）」占位、不 `vfs.read` 全文、不写 file_cache；探测失败/不支持/null 保守回退原路径；`filename` 档位不探测 |

## 详细改动说明

- 输入闸放在解析之前是刻意的：48MB 的闸门只做一次长度比对，零内存放大；放进解析链之后任何一点都可能先 OOM。
- 三闸放在 Phase A 路径校验之后、事务之前：解析成 md 树后已能精确计量（UTF-8 字节），拒收时零写库，不会留下半写状态。
- `prepareUserMessagesForPrompt` 的首次引用附全文与 `assembleWorkplaceDisplay` 共用 `loadOrFillFileCache`，一处降级两处受保护。
- 存量毒数据的探测走双通道是因为仓库新写路径 `vfs_entry.content` 恒为 NULL、正文在 `vfs_content_blob`（zlib 压缩，无明文大小列），`byte_len` 是明文下界；按典型 4× 压缩比折算并取保守方向（极端高压缩比内容理论可绕过，现实角色卡数据不会落入该窗口，注释已说明）。
- 不改：`ensureImportDirRules` 默认启用语义（产品行为）、消息 tail 40 分页、工作区树元数据列表（本就健康）、tokenizer、编辑器打开文件路径（用户主动点开大文件不属于启动存活范围；中招用户重启后可经元数据列表删除毒目录自救）、desktop/CLI 单独改动（core 闸门已覆盖）。

## 测试策略

### 测试用例

- `test/character-card/validate-md-tree-limits.test.ts`：三闸各自超限抛 `TOO_LARGE`（含实际值/上限值文案）；恰在上限放行；`utf8ByteLength` 与 TextEncoder 基准一致（含代理对）。
- `test/character-card/character-card-import.test.ts`：输入闸与树闸均零写库（事务未开启）。
- `test/workplace/load-or-fill-file-cache.test.ts`：内联与 blob 两类超限 → 占位、不触发 `vfs.read`、不写 file_cache；探测抛错与返回 null 回退原路径；cache 命中短路；`filename` 档保持原行为。
- `test/vfs/sqlite-vfs-entry.repository.test.ts`：blob 行 / 目录 / 不存在路径 / 遗留内联行的 `findContentSizeByPath` 各形态。
- `test/workplace/assemble-workplace-display.test.ts`：真库全链——超闸 blob 文件在展示中得到占位、正文不出库、file_cache 不写、正常文件不受影响。
- `apps/mobile/__tests__/document-io.test.ts`：stat 超限抛业务错误；stat 失败放行；未传 `maxBytes` 行为不变。

### 全量回归

core `npm test`（node:test + tsx）1841 例全绿；mobile `NODE_ENV=test npx jest` 186 套件 1095 例全绿；core `npm run build` / `typecheck`、mobile 官方 `typecheck` 全部通过。

## 风险与回滚方案

- 风险一：blob 压缩闸按 4× 折算偏保守，极低压缩比但总量合法的文件可能被占位（用户感知为该文件不出现在上下文）。接受：占位只影响上下文组装，文件本体与编辑器不受影响，且方向是「应用存活优先」。
- 风险二：阈值误伤超大合法卡。输入 48MB / 单文件 8MB 覆盖已知重度世界书卡（5–10MB）量级，留有余量。
- 回滚：三个提交相互独立可单独 revert（86522528 导入闸 / 342e7bbd mobile 预检 / d89efde1 读取侧降级）；revert 读取侧降级即恢复原读取行为，无数据迁移、无 schema 变更，回滚零残留。

## 追记：第二根因与最终修复（2026-09-07 深夜复现轮）

元凶卡片实测并非巨型（11.5MB PNG / 2.5MB 内容 / 556 文件 / 单文件 ≤33KB），四道闸门全部放行；模拟器复现不出崩溃（x86 快，平方成本仅 ~0.3s）。真机（荣耀）复现出真实形态：导入成功，首次进入会话工作区时 `evaluateWorkplaceRuleView` 占死 JS 线程（103% CPU、分钟级、浪潮式重跑），列表永远「加载中…」，强制退出致缓存未落盘、重启重跑——即受害者「打不开」的全部机制；低端机叠加内存压力即升级为 LMK 杀进程（真崩溃）。

根因：规则引擎旧实现对**每个文件**重排其全部兄弟（`computeDisplay` 每文件全量扫 fileSet + `sortFilesForDir` 兄弟重排 + `findIndex`），单目录 540 文件 = 540 次 O(N·logN) 智能文件名排序（collator 单次比较微秒级），总复杂度 O(N²·logN)。

最终修复（d040dc3f）：`workplace-rule-engine.ts` 重构为一次遍历按父目录分组、每目录仅排序两次（auto 名单 / 全量名单）、名次与序列落 Map 供 O(1) 查询；行为与旧实现完全一致。桌面毒库 harness 287.9ms→17.8ms；真机 556 文件 reload 由永不返回→0.4s。回归测试 `workplace-rule-engine-large-dir.test.ts`（600 文件大目录截取语义 + 性能哨兵）。

诊断方法留档：release 构建 console.log 探针（ReactNativeJS tag 出 logcat）+ adb top -H 采 JS 线程 CPU；注意 metro 缓存会吞 workspace dist 变更，重打包前清 node_modules/.cache/metro 并 --rerun-tasks bundle 任务。

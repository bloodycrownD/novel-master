
## presentation 降级 + attachment-chip descriptor 化（用户裁决，同分支追加，2026-11-21）

用户质疑 `packages/core/src/presentation/` 定位后裁决：降级 domain/chat/presentation + 补 i18n 一起做（`347b62b24`）。

**定位判定**：顶级 presentation 名义是横切展示层（与 errors/common/bootstrap 并列），实际只有一个子域 chat、且 rollback-confirm 反向 import `domain/chat/i18n/keys`——是 chat 域展示尾巴被错误升层。「升层要有第二个消费者」判据反推降级。

**关键发现**：`label.attachment.action.*`（8 键）+ `label.attachment.chip` 模板 `{action}:{path}` 在 keys.ts/双 yaml **双语齐备却零消费**——当初为 chip 预留的 i18n 键从未接线，attachment-chip 一直硬编码 STATUS_CHIP_ZH 中文映射直出。教训：**i18n 盘点只扫 apps 层会漏 core 内的展示层**；以及「预留键要有接线时限，否则就是死键与硬编码并存的假 i18n」。

**坑三条**：
1. core 有两套 catalog：`src/i18n/generated-catalog.ts`（从 catalog/*.yaml 生成，ui.*/error.* 段，三端 coreT 用）与 `locales/chat.*.json`（chat 域独立，rollback 用）。**coreT 不含 chat.json**——chip key 若挂 chat.* 段，coreT 渲染出裸 key（#243 同坑）。我新造 `ui.chat.chip.*` 是重复建设，最终接既有 `label.attachment.*`。
2. webview bundle gate B：消费方 import 改门面（`@novel-master/core/chat`）会把整个 chat 门面拉进 bundle（100 模块 RED）。webview 必须 deep import leaf——exports 加窄子路径 `./domain/chat/presentation/*`，WEBVIEW_CORE_ALLOWLIST 同步迁移。
3. webview `uiText` 不支持嵌套 descriptor（只 String 插值；core createTranslator 才递归）——chip 的 `{action}` 嵌套位要两步渲染（先 uiText 取 action 词再插模板），逻辑归 RowLogic.attachmentChipText（namespace 归属）。

**顺带删零消费死码** `user-vfs-turn-preview.ts`（全仓除定义处零 import）。
终态：typecheck 15ws / core 687×4 / desktop 774 / mobile 2384 / nm-style 三段+top-let 全零 / public-ownership PASS（例外表补 p25 namespace 化新名 VfsToolFilePath）。

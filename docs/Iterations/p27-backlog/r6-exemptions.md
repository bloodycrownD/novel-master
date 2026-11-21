# R6 豁免登记口径

R6 验收「UI/错误桶硬编码中文 grep=0（日志/测试桶豁免并登记口径）」的豁免登记文件。波 3 各片收口时，凡命中本文件的处数不计入迁移口径；新类别（日志/测试断言的精确口径）随片补登。

## CSS `content` 伪元素文案（4 处，不迁）

CSS `::before` / `::after` 的 `content` 由样式表渲染，translator 无法介入（selector 里没有 JS 执行点；`attr()` 取的是 DOM 属性，宿主 translator 下发也进不了 stylesheet）。i18n 化需要把文案改成 `attr(data-*)` 引用 DOM 属性并让渲染层写属性——属结构性改造，不是文案迁移，p27 R6 明确不做。

登记位置：`apps/mobile/src/web/shared/rich-content-styles.ts`（两管线共用的富内容样式；webview 层，mobile/desktop 共享同一份 web 样式资产）。

| 处 | 行 | 文案 | 挂点 |
| --- | --- | --- | --- |
| 1 | :136 | `复制` | 代码块复制按钮 `::after`（默认态） |
| 2 | :138 | `已复制` | 代码块复制按钮 `::after`（已复制态） |
| 3 | :199 | `Mermaid 源码` | Mermaid 失败回退块 `::before` 标题 |
| 4 | :204 | `图表渲染失败，已回退源码` | Mermaid 失败回退块 `::before`（`attr(data-mermaid-error, …)` 的 fallback 值） |

同文件 `content: attr(data-lang)`（:141）无中文默认值，不在豁免口径内。

## 桥接面盘点备注（第 0 片现场口径，供波 3 对账）

- `apps/mobile/src/web` 层用户可见中文文案（排除 console 日志、CSS content、`labels.ts` 既有 4 键兜底）现场盘点 27 处文案实例：
  - chat-transcript webview 管线 25 处 → 去重后 23 键，已立为 `ui.transcript.*`（core keys.ts `UI_MESSAGE_KEYS`，第 0 片随桥入库）；
  - rich-document webview 管线 1 处（`document-model.ts:6` `OVER_LIMIT_HINT`）与两管线共用的 mermaid-fullscreen 1 处（`MermaidViewerOverlay.tsx:383` `关闭`）**未立键**——两条管线的 `init` 载荷还没有 labels 通道（探针口径的 `init.labels` 4 键桥仅指 chat-transcript 管线），扩第二座桥归波 3 对应片。
- 探针报告的 webview 21 处与现场 27 处的差异即上述 4 处（rich-document 1 + mermaid-fullscreen 1 + aria-label 语义合并等盘点口径出入），以本文件清单为准。

## 基建 throw 诊断文案（不迁，波 3 各片汇总）

面向开发者的诊断/不变量文案，非用户可见文案；与 p27 R6「日志不迁」同口径。按 throw-audit 既有基线管理，不立 i18n 键。

| 来源 | 位置 | 内容 |
| --- | --- | --- |
| 波 3-1 E 线 | polyfills / webview-host / db-file-path / mobile-sksp | 基建 throw（Headers 必须是 JSON 对象、运行时尚未就绪、角色卡文件不存在等 29+6 处） |
| M1 | novel-master-context | runtime 重建超时/已取消 Error 构造 2 处 |
| M2 | ProviderForm.tsx:91/94 | BOUNDARY dev throw 3 处（已在 throw-audit 基线登记 BOUNDARY，基线站点键随 coreT 化同步过） |
| M3 | FileEditorScreen | `throw new Error('缺少 projectId')` 等 4 处 |
| D3 | workspace vfs 段 | segment index 越界（内部不变量）1 处 |

## 协议依赖字面文本（不迁，待错误通道改造后随迁）

`apps/mobile/src/services/map-cloud-sync-sdk-error.ts:56` 的 `message.includes('请先配置云存储')` 是**错误归一判据**：依赖 buildS3StorageConfig / pull / push 三处 AppError detail 的字面文本流动。迁移文案即破坏匹配协议，需先改为 code 判定（错误通道结构性改造，超出 R6 文案迁移范畴）。整组跳过，改造时随 descriptor 化一并迁移。

## AppError detail 形态（错误通道，descriptor 化归后续迭代）

以下为 `AppError` detail 载荷 / IPC 错误参数化校验中的中文，属错误通道数据而非 UI 直取文案。R6 口径：错误消息走 `error.*` 码表 + descriptor（core 抛错点已 G1.x descriptor 化）；组件层 detail 字面量的 descriptor 化与协议改造（上一条）同一批做，p27 不动。

| 位置 | 内容 |
| --- | --- |
| apps/mobile/src/services/cloud-sync-config.store.ts:159-163 | 请填写 Endpoint/Bucket/Access Key/Secret Key |
| apps/desktop/shared cloud-sync-config.store.ts:98/180 | 同款镜像 |
| apps/desktop/src/main handler-registry.ts:118/127 | 「拖出失败」fallback |
| format-ipc-error.ts | 参数化校验文案 |

## composed 拼接句（不立整句键，标签键拼装）

图表 inspect 行、io 组合段（【输入】/【输出】）、「已移动 N 项」「清理完成 A → B」「发现新版本 X」等拼接句不立整句键——由 `ui.stats.*` / `ui.chat.io_*_label` 等标签键取回后消费方拼装（U 线保守清单 3/4 口径，波 3 各片照此执行）。

## webview closeLabel 缺省值（接线设计，非漏迁）

`MermaidViewerOverlay` 的 `closeLabel` prop 缺省 `'关闭'`（波 3-2d M 线两点接线）：生产路径两桥 labels 通道恒下发 `ui.common.close`，缺省值仅是未注入时的兜底语义（与 web 端 DEFAULT_*_LABELS 兜底同性质），不迁。

## 桥接面盘点对账收口（波 3 终态）

上文「桥接面盘点备注」中两处「未立键」已收口：rich-document 管线第二桥（`RichDocumentBridge` labels 通道 + `rich-document-labels.ts` 宿主装配，波 3-1）与 mermaid 全屏关闭（两桥随发 `ui.common.close`，波 3-1 立键、波 3-2d 接线消费）。web 层用户可见中文按本文件豁免口径清零。

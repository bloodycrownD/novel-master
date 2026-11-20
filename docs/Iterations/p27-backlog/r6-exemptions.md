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

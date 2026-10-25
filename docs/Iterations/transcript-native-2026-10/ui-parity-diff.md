# UI Parity 差异清单（旧 webview transcript vs RN 新实现）

日期：2026-10-15 · 真机 dogfood（DSLDU20407006179，1.5.42-transcript）用户反馈驱动
旧版真源：`890561523c`（P5 父提交）树 `apps/mobile/src/web/chat-transcript/styles/transcript.css`（514 行）
+ `web/shared/rich-content-styles.ts`（富文本） + `src/theme/tokens.ts`（主题双套）
新版真源：HEAD `c44c5e966` 树 `src/components/chat/transcript/*` + `ToolCallCard/ThinkingBlockCard`

旧版设计语言：**iOS 原生消息风**（App 自身 token：#007AFF/#0A84FF 蓝、surface 白、bg #F2F2F7/#000000）
新版实现语言：**混合自创**（GitHub 代码配色扩大化 + 灰用户气泡 + 蓝强调块）

## 差异清单（按视觉权重排序）

### D1 [P0] 用户气泡—— iOS 蓝底白字 → 灰底描边
| 项 | 旧 | 新 |
|----|----|----|
| 底色 | `var(--primary)` **#007AFF** / #0A84FF | `tokens.bgSecondary` **#E5E5EA** / #1C1C1E |
| 字色 | **#fff** | tokens.text（深色） |
| 描边 | 无 | borderLight hairline |
| 圆角 | 16 | 12 |
| padding | 10/14 | 6/10 |
角色标签（用户行内）：旧 rgba(255,255,255,0.85) 白 → 新 textTertiary 灰。

### D2 [P0] 代码块—— 玻璃态 → GitHub 实色
| 项 | 旧 | 新 |
|----|----|----|
| 底色 | rgba(0,0,0,0.045) 半透明（浅色≈#F4F4F4；深色在黑底≈无差） | **#F6F8FA / #0D1117**（GitHub light/dark） |
| 边框 | var(--border) #E5E5EA/#2C2C2E | #D0D7DE / #30363D（GitHub） |
| 圆角 | 6 | 8 |
| padding | 0.55em/0.7em ≈ 8/10.5 | 10 |
| 语言标签 | pre[data-lang]::before 0.78em 小写灰 | （待核）大概率无 |
| 复制按钮 | 右上常驻「复制/已复制」 | （待核）大概率无 |
高亮 token 双套（hljs GitHub 色）新旧一致 ✓——差异只在**容器**。

### D3 [P1] 思考块—— 无壳嵌入 → 卡片壳
| 项 | 旧 | 新 |
|----|----|----|
| 容器 | transparent 无壳（嵌气泡内） | bgSecondary 底 + borderLight 描边 + radius 10 + padding 12/10 |
| title | 12/600 textSecondary ✓ | 12/600 ✓ |
| body | 13/1.45 textSecondary ✓ | 13/19 textSecondary ✓ |
| 折叠箭头 | css border 三角（跨机型一致） | （待核）字符或图标 |
新版加了壳 → 视觉重量明显增大。

### D4 [P1] blockquote—— 中性左线 → 蓝色圆角卡
| 项 | 旧 | 新 |
|----|----|----|
| 形态 | 左边框 3px var(--border) + padding-left 0.75em，无底无圆角 | **#007AFF55/#0A84FF66 蓝边** + **#007AFF0A/#0A84FF12 蓝底** + radius 8 + padding 10 |

### D5 [P1] 列表 bullet—— 文本色 → 蓝
- 旧：UA 默认 bullet（文本色）；新：`bulletColor: t.primary` 蓝点。

### D6 [P1] 标题层级—— 观感偏大
- 旧：h1≈17px(1.15em)/700、h2≈16px/700、h3 15px/700
- 新：h1 **20px**、h2 **17px**、h3 15px/**600**

### D7 [P1] 行内 code—— 继承色 → GitHub 固定色
- 旧：0.9em≈13.5px、继承气泡字色（用户行=白）、rgba(0,0,0,0.06) 底、radius 4、无描边
- 新：13px、**固定 #24292F/#E6EDF3**（用户气泡内也是深色字）、有 borderColor
- **用户气泡内的行内 code 在灰底上还行；若 D1 修复回蓝底，则必须回继承/白色。**

### D8 [P2] 胶囊浓度（@文件/$技能）
- 旧：primary 12%（rgba .12）；用户气泡内反色白 26%
- 新：light #007AFF14（8%）、dark #0A84FF26（15%）——浓度漂移。

### D9 [P2] 角色标签行
- 旧：12px/600 textSecondary；新 11px textTertiary（更小更淡）。

### D10 [P2] 助手气泡形态
- 旧：surface 底无描边、radius 16、padding 10/14；新 surface ✓ + 描边、radius 12、padding 6/10。

### D11 [P2] 段距/行高微调
- 旧：p 段距 0.35em≈5.25px、正文 15/1.4≈21；新：marginBottom 6、lineHeight 22——近似的密度补偿（可不动）。

### D12 [待核] 工具卡
- 新版 padding 12 ✓ radius 8 ✓ surface ✓ name 14/600 ✓ status/summary/openHint 数值全对——**基本 parity**；
  待核：invoking 蓝点脉动动画、tool-invoking-bar 顶部分隔线、tappable 蓝描边触发态。

## 根因
spec S3「GitHub flavor 渲染」决策本义 = **代码高亮 token 双套**（旧版同款 hljs 色）。
P1 实现时扩大为整体 GitHub 风格（代码块容器、blockquote、bullet），且气泡/思考卡偏离
旧版 iOS 风——**没有任何一项对照旧 CSS 实现**（旧 CSS 在 P5 才退役，P1 实现时它还在，
但 spec 未要求逐块 parity，实现自由发挥）。

## 修复方向（供 CR fix-spec）
1. D1/D10：气泡族回 iOS 风——用户蓝底白字（primary）无边框 radius 16 padding 10/14；
   助手去描边同 radius/padding。角色标签 D9 一并回 12/600 secondary（用户行白色 85%）。
2. D2：代码块容器回玻璃态（rgba(0,0,0,0.045)/var(--border)/radius 6）；保留双套高亮 token ✓。
   补语言标签 + 复制按钮（EnrichedMarkdownText codeBlock 渲染能力待核）。
3. D3：思考块去壳（透明嵌气泡）。
4. D4/D5：blockquote 回中性左线；bullet 回文本色。
5. D6：h1/h2/h3 回 17/16/15，h3 字重 700。
6. D7：行内 code 回继承色（D1 后用户行为白）、去描边。
7. D8：胶囊浓度统一 12%（rgba 同构）。
8. D12：核对动画/分隔线/触发态三项后按需补。

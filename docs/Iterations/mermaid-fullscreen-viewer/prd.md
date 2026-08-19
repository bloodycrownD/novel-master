---
date: 2026-08-20
dependency: [Iterations/markdown-preview-mermaid/prd.md]
---

# Mermaid 图表全屏查看与缩放 PRD

## 背景

mermaid 图表渲染已上线（`Iterations/markdown-preview-mermaid`，v 集成分支 feat/chat-improvements-integration）。手机屏幕上，渲染出的图表宽度受消息卡片/正文列宽限制，节点多、流程长的图表在小图里根本看不清。用户真机验证渲染成功后提出：希望点击图表进入全屏查看，并支持放大。

技术现状（探索确认）：SVG 只能在 WebView 内生成（消毒白名单不含 SVG）；WebView 内覆盖层有成熟样板（chat-transcript 的 `#menu-portal` + `MenuOverlay`）；全 app 无 pinch 缩放先例，本需求为从零到一。

## 目标（含成功指标）

- 用户在 mobile 上点击渲染成功的 mermaid 图表，可进入全屏覆盖层查看
- 全屏态支持双指缩放、双击缩放、单指拖拽平移，可清晰阅读大图细节
- 成功指标：预览与聊天两处入口均可全屏；缩放/平移流畅无卡顿（60fps 体感）；任意关闭路径可退出全屏且原图不受影响

## 用户与场景

- mobile 用户在文件预览（markdown 富文本）中查看含 mermaid 图表的文档
- mobile 用户在聊天记录中查看含 mermaid 图表的消息（历史消息定稿态）

## 范围
### 包含范围
- mobile 文件预览（rich-document WebView）的 mermaid 图表全屏
- mobile 聊天（chat-transcript WebView）历史/定稿消息的 mermaid 图表全屏
- 全屏覆盖层交互：双指 pinch 缩放、双击缩放（放大/还原切换）、单指拖拽平移
- 关闭方式：点击空白区域、右上角关闭按钮、Android 系统返回键
- 渲染失败态（源码回退展示）不可进入全屏

### 不包含范围
- desktop 侧（用户诉求为手机查看不便，desktop 窗口本身可拉伸）
- 流式输出期间的未定稿图表（该阶段本就是源码占位，不渲染）
- 图表的导出/保存为图片
- 双指缩放之外的多点手势（旋转等）

## 核心需求（3-7 条）

1. **点击进全屏**：渲染成功的 mermaid 图表节点可点击（有可点击的视觉暗示，如 hover/按压态），点击后在当前 WebView 内弹出全屏覆盖层，展示该图表 SVG（克隆，不移动原图 DOM，批注与原渲染不受影响）
2. **缩放**：双指 pinch 自由缩放（含缩放边界限制，不允许缩到消失或无限大）；双击在「原始大小」与「放大档位」间切换
3. **平移**：放大后单指拖拽平移查看局部，平移范围有边界（不允许把图拖出视野回不来）
4. **多入口一致**：文件预览与聊天气泡两处管线共享同一套全屏查看实现（样式单源），交互行为完全一致
5. **退出**：点空白、右上角关闭按钮、Android 返回键三种方式均可退出；退出后回到原图原位
6. **主题协调**：全屏层背景与当前明暗主题一致（深色主题不刺眼）

## 验收标准

- Given 预览中含渲染成功的 mermaid 图表 When 点击图表 Then 全屏覆盖层弹出并完整展示该图
- Given 聊天历史消息含 mermaid 图表 When 点击 Then 同样进入全屏（与预览交互一致）
- Given 全屏态 When 双指捏合/张开 Then 图表连续缩放且不超出边界限制
- Given 全屏态 When 双击 Then 在原始大小与放大档位间切换
- Given 已放大 When 单指拖拽 Then 图表平移且不能拖出边界
- Given 全屏态 When 点空白 / 点关闭按钮 /（Android）按返回键 Then 覆盖层关闭，原图与批注状态无损
- Given 渲染失败的图表（源码回退态）When 点击 Then 不进入全屏
- Given 深色主题 When 进入全屏 Then 背景为深色，图表配色协调

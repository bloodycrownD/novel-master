# 2026-10-15 UI parity 敏捷修复立项（transcript-native 迭代）

## 类型与定位
- 类型：**bug**（RN 化 transcript 样式与旧版 webview 基线全面偏离，用户真机 dogfood 反馈）
- 敏捷名称：`ui-parity-ios-restore`
- 父迭代：`iterations/transcript-native-2026-10/`（分支 feat/transcript-native，worktree D:\worktree\transcript-native）
- 用户拍板：不进 CR loop（开发未完，非收尾审查），走 agile-dev 流程
- 差异清单（探索产物，已落盘）：`docs/Iterations/transcript-native-2026-10/ui-parity-diff.md`（D1–D12，根因=GitHub flavor 扩大化+实现未对照旧 CSS）

## 旧版基线真源（已挖）
- `890561523c`（P5 父提交）：`apps/mobile/src/web/chat-transcript/styles/transcript.css` + `web/shared/rich-content-styles.ts` + `src/theme/tokens.ts`
- 旧版设计语言：iOS 原生消息风（#007AFF 用户蓝底白字气泡/surface 助手/rgba 玻璃态代码块/无壳思考块/中性 blockquote）

## 进度
- Step1 判型完成（本文件）
- 待办：Step2 探索（三个待核项：D2 代码块语言标签/复制按钮能力、D3 思考块箭头、D12 工具卡动画细节）→ Step3 子代理实现 → Step4 验证（jest/tsc+真机重装）→ Step5 留痕 → Step6 用户确认

## 真机环境备忘
- 真机 DSLDU20407006179（华为 EBG-AN00）已装 205042/1.5.42-transcript（预打包 JS debug APK：`debuggableVariants=[]` 临时构建后已还原 build.gradle）
- release 构建被 Windows MAX_PATH 挡（enriched-markdown codegen ninja 对象路径 >260），debug 链无此问题

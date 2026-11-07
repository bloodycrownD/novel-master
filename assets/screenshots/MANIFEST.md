# 移动端宣传截图 · MANIFEST

- 采集时间：2026-11-08（设备时钟 2026-11-07 18:00 左右 UTC，界面显示 6:0x）
- 采集环境：Android 模拟器 AVD `Medium_Phone_API_36.1`（serial `emulator-5554`），1080 × 2400 @ 420dpi
- 应用：`com.novelmaster`（debug 包，Metro dev server `:8081`，adb reverse 已连）
- 主题：亮色（顶栏月亮图标为「切到深色」的浅色态）
- 演示数据：项目《星轨旅人》→ 会话「雪落关 · 开篇」「灯城 · 巡夜」；工作区 4 个文件：
  `/设定/世界观.md`、`/设定/人物/云岫.md`、`/卷纲/第一卷.md`、`/章节/001-雪落关.md`（全部原创虚构内容，261–300 字）
- 服务商结论：内置 `OpenCode Zen` 只带默认 `public` key，实测生成返回 `HTTP 401 {"type":"error","error":{"type":"AuthError","message":"Missing API key."}}`；免费模型返回 `FreeUsageLimitError`。**没有可用服务商，因此没有任何一张图包含真实 AI 回复。**
- 采集方式：`adb -s emulator-5554 exec-out screencap -p > 文件`（PNG，全部 1080 × 2400，均 > 30KB 校验通过）
- 双路径：`assets/screenshots/` 与 `website/public/screenshots/`（MD5 抽查一致）
- 过程截图留在 `_progress/`，未参与交付

| 合同文件 | 画面内容 | 状态 | 说明 |
|---|---|---|---|
| `home.png` | 对话 tab 的项目主页：《星轨旅人》标题 + 「雪落关 · 开篇」「灯城 · 巡夜」两张会话卡片 | partial | **没有项目卡片**。项目列表在顶栏「项目列表」抽屉里，抽屉会同时显示模拟器上 5 个历史真实项目（含不宜公开的标题），为避免泄露用户内容未采用；改截当前项目主页，标题即项目名 |
| `chat.png` | 「灯城 · 巡夜」聊天页，输入框已打好「先按卷纲把第二节写出来，云岫巡夜时发现少了一盏灯。」未发送 | partial | **needsProvider**：无可用服务商，没有 AI 回复与文件工具卡。按任务约定截「输入框打好消息不发送」 |
| `workspace.png` | 聊天工作区根层：路径 `/` + 「卷纲 / 设定 / 章节」三个目录卡（各 1 个文件、同步「开启」）+ 上级目录 / 从上级同步 / 推送到项目工作区 / ⋯ 工具条 | done | 2026-11-08 主代理补拍：原版取景钻进 `/章节` 只露 1 个文件，改回根层展示目录结构与同步状态；章节正文见 `annotate.png` |
| `annotate.png` | 会话工作区 `001-雪落关.md` 预览态（Markdown 档），划词选中「像有人拿碎瓷片一片一片试她的耐性」并弹出「复制 / 批注」菜单 | done | 批注三条件齐备（预览态 + 会话域 + Markdown 档） |
| `context.png` | 「灯城 · 巡夜」一条用户消息的「⋯」操作菜单：编辑 / 复制 / 置位 / 分叉 / 回滚（回滚标红） | partial | **缺「压缩」**：该菜单没有压缩项，`压缩上下文` 在「会话详情页」（顶栏 ☰）里，无法与置位/回滚同屏。菜单由消息右上角「⋯」打开，长按气泡的菜单已废弃 |
| `agents.png` | 我的 → 智能体配置 →「子智能体」页签：general（内置）、理性助手、写作助手、感性助手 | done | 列表页，非编辑页 |
| `skills.png` | 我的 → 技能管理 →「全局技能」页签：agent-config、workspace-organize、助手派遣、时序图大纲、节拍成章 | done | 项目技能页签为空，未采用 |
| `stats.png` | 我的 → 数据统计 →「图表」页签（近 7 天 / 全部模型） | partial | 区间无数据：无可用服务商，本会话 0 次成功生成、0 token 记录。库内有更早的历史用量，但与本会话无关，未借用 |

## 过程与坑

1. 默认 5037 端口的 adb server 卡死（多进程挂起），全程改用 `ANDROID_ADB_SERVER_PORT=5038` 另起 server，命令才正常返回。
2. `@novel-master/core` 未构建时 Metro 直接拒绝启动（`metro.config.js:31` 报 missing `infra/log/index.js`），先跑 `npm run build -w @novel-master/core` 才起来。
3. `adb shell input text` 不支持非 ASCII（抛 NPE），中文输入改用 ADBKeyboard（IME `com.android.adbkeyboard/.AdbIME`，`ADB_INPUT_B64` 广播）。截图结束后已把默认输入法切回 Gboard；按硬规则未卸载该 IME。
4. 4 个演示文件用「ZIP 导入」落到会话工作区（先 `tar -a -cf` 打包、`adb push` 到 `/sdcard/Download/`，再在 聊天工作区 → ⋯ → 导入 → ZIP 包 选择），中文文件名与正文均正常，未使用数据库直改。
5. 生成失败会留下 `[生成失败] …` 助手气泡；为此先用「回滚」清掉，再用「发送后 0.8s 点终止」得到只有用户消息的干净会话用于 `context.png`。
6. 全程未执行 `adb uninstall` / `pm uninstall` / `pm clear`，未清除任何应用数据；未对模拟器上已有的历史项目、会话、备份文件做任何修改或删除。

# Mobile 稳定性修复与数据库迁移 技术规格（SPEC）

## 设计目标

在 **Android Mobile** 上交付 PRD 五项能力，且改动面可控、可回归：

| # | 问题 | 设计要点 |
|---|------|----------|
| 1 | 创建服务商后延迟闪退 | 收敛创建后导航/弹窗竞态；减轻 `ProvidersScreen` 全量 N×M 采样查询 |
| 2 | 消息长按菜单小屏不可见 | 横向条改为可滚动/纵向列表，解除 `overflow: hidden` 裁切 |
| 3 | 覆盖安装聊天气泡 DOM 异常 | 版本升级时强制 Remount 富文本；FlatList `extraData` 同步 |
| 4 | 全库导入导出 | 文件级复制 `novel_master_vfs` SQLite；导入前关连接并 `rebootstrap` |
| 5 | 目录规则移除全文本 | Mobile UI 去掉 `fill: full`；历史值映射为 `hidden` |

**不在本 SPEC**：iOS、DB 合并导入、Core/CLI 目录规则 UI 变更、加密备份。

---

## 总体方案

```mermaid
flowchart TB
  subgraph fixes [Mobile fixes]
    P[Provider create flow]
    M[MessageActionMenu layout]
    R[Rich render epoch on app version]
    D[db-backup.service]
    W[DirectoryRuleSheet fill options]
  end
  subgraph core [Core]
    E[EVENT_AGENT_STEP_COMMITTED - unchanged]
  end
  P --> ProvidersScreen
  M --> ChatTabScreen
  R --> MessageList + RichContentBody
  D --> connection.ts + NovelMasterProvider.retry
  W --> DirectoryRuleSheet
```

### 1. 服务商延迟闪退（根因假设与对策）

**现状**

- `ProviderCreateScreen` 保存后 `Alert.alert`，按钮内 `navigation.replace('ProviderDetail')` 或 `goBack()`（`apps/mobile/src/screens/stack/ProviderCreateScreen.tsx`）。
- `ProvidersScreen` 在 `useFocusEffect` 中 `reload()`：对每个 provider 的每个 saved model 调用 `modelSamplingProfiles.getProfile`（`ProvidersScreen.tsx` L55–78），创建后回到列表会触发 **重负载** 焦点刷新。
- `ProviderDetailScreen` 依赖 `route.params.providerId`；若导航竞态导致短暂 `undefined`，`reload` 早退但不应崩溃——需确认无其它未守卫原生调用。

**方案**

1. **创建成功 UX**：去掉「保存后双按钮 Alert」竞态；改为 `Toast` + `navigation.replace('ProviderDetail', { providerId })`（或 `goBack` + 列表自动 focus 刷新），确保 **不在 Alert 回调里做 stack replace**。
2. **列表 reload 减负**：`ProvidersScreen` 列表行仅展示 `savedCount` + `apiKeyStatus`；**采样配置数量**移到 `ProviderDetailScreen` 或按需懒加载（进入详情再算）。列表 `reload` 只做 `providers.list()` + `savedList().length`。
3. **防护**：`ProviderDetailScreen` / `ProviderCreateScreen` 对 `providerId`、create 错误用 `try/catch` + toast；`__DEV__` 记录 create 完成与 focus reload 耗时便于真机验证。

### 2. 消息长按菜单小屏适配

**现状**

- `MessageActionMenu` 为 **单行横向** `flexDirection: 'row'`，固定 `MENU_HEIGHT=48`，`overflow: 'hidden'`（`MessageActionMenu.tsx`）。
- `buildMessageActionItems` 最多 **6 项**（编辑、隐藏/取消隐藏、复制、Fork、回滚、删除）（`message-edit.ts`）。
- 宽度 `min(itemCount * 64, screenWidth)`：小屏上每项 `flex:1` 仍可能被压扁且 **无法横向滚动**，底部/侧边定位也可能把条挤出可视区。

**方案**

- 改为 **纵向 `ScrollView`**（`maxHeight = min(360, windowHeight * 0.45)`），菜单锚定在气泡上方/下方（保留现有 `layoutAnchoredMenu` 水平居中逻辑，垂直方向用 scroll 容器高度）。
- 每项一行、`minHeight` 44dp，危险操作用 `danger` 色。
- 保留透明 backdrop 点击关闭；单测覆盖 `layout` 与 ≥6 项时 `contentSize` 可滚动（jest 量 `items.length` + 样式断言即可）。

### 3. 覆盖安装 DOM 异常

**现状**

- 富文本由 `RichContentBody` → `react-native-render-html`（`RichContentBody.tsx`）。
- `MessageList` 的 `FlatList` **未**把 `chatRichTextEnabled` 传入 `extraData`；`keyExtractor` 仅 `msg-${id}`，升级后 bundler 新、原生/WebView 状态旧可能导致 **DOM 节点失效**。
- `prepareRichHtml` 无跨版本缓存，问题更可能来自 **RenderHTML 实例复用** + 覆盖安装保留 AsyncStorage/KKV 中 `chatRichText=true`。

**方案**

1. **`app-version-guard.ts`**：启动时对比 `package.json` version（或 `react-native` 的 `DeviceInfo.getVersion()`）与 KKV `app.lastRunVersion`；若变化则写入新版本并返回 `richRenderEpoch++`（存 KKV 整数）。
2. **`MessageList`**：`extraData={{chatRichTextEnabled, richRenderEpoch}}`；`RichContentBody` 增加 `renderKey={`${message.id}:${richRenderEpoch}`}` 强制 Remount。
3. **可选保险**：版本变更后首屏不对用户关闭 `chatRichText`，仅 Remount；若仍复现，再在升级后第一次启动 toast「已刷新消息渲染」。
4. **FlatList**：`removeClippedSubviews={false}` 仅在对富文本消息仍异常时启用（先默认不改，减少性能回退）。

### 4. 全库导出/导入

**现状**

- 单库：`MOBILE_VFS_DB_NAME = 'novel_master_vfs'`，`MOBILE_TDBC_URL = tdbc:sqlite:file:novel_master_vfs`（`vfs/constants.ts`）。
- 连接单例：`getMobileConnection` / `closeMobileConnection`（`db/connection.ts`）。
- 已有 `vfs-zip.service.ts` 模式可参考（`saveDocuments` / `pick` + `ReactNativeBlobUtil`）。
- Runtime 重建：`NovelMasterProvider` 的 `bootToken` → `retry()` 可重新 `createMobileNovelMasterRuntime()`。

**方案**

新建 `apps/mobile/src/services/db-backup.service.ts`：

| 步骤 | 导出 | 导入 |
|------|------|------|
| 1 | `conn.execute('PRAGMA wal_checkpoint(FULL)')` 或 quick-sqlite 等价 | 用户二次确认 Alert |
| 2 | 解析 DB 文件路径（见下） | `closeMobileConnection()` |
| 3 | 复制到 `CacheDir/novel-master-backup-{timestamp}.nmbackup` | 校验文件头/SQLite magic |
| 4 | `saveDocuments` 分享 | 复制覆盖目标 DB 文件 |
| 5 | Toast 成功 | `retry()` 重建 runtime + Toast「请稍候」 |

**DB 路径**：在 `db/connection.ts` 增加 `getMobileDatabaseFilePath()`：

- 优先使用 `react-native-quick-sqlite` 的 `open({ name: MOBILE_VFS_DB_NAME, location: 'default' })` 返回的 `dbPath`（与 `tdbc-driver-rn` 一致，见 `quick-sqlite.adapter.test.ts`）。
- 若 API 不可用，回退 `ReactNativeBlobUtil.fs.dirs.DatabasesDir + '/novel_master_vfs'`（Android 文档目录）。

**备份格式 MVP**：单文件 SQLite，扩展名 `.nmbackup`（实为 SQLite3）；可选文件头 4 字节 `NMDB` + 版本 `u32` 便于拒绝误选 ZIP（非必须，MVP 可用大小 + SQLite magic `SQLite format 3`）。

**UI**：`ProfileTabScreen` 增加「数据管理」`ListSectionTitle` + `ProfileMenuItem`「导出数据库」「导入数据库」；导入前 `Alert` 文案说明 **将完全替换** 当前数据。

**Agent 运行中**：导入/导出前检测全局 `agentRunning`（可从 context 或简单 module flag）；若运行中则 toast 拒绝。

### 5. 目录规则移除全文本填充

**现状**

- `DirectoryRuleSheet` 的 `FILL_POLICIES` 含 `{ value: 'full', label: '全文本' }`（L43–47）。
- Core 仍支持 `FillPolicy = "full"`（PRD 不改 Core 语义）。

**方案**

- `FILL_POLICIES` 仅保留 `filename` | `header` | `hidden`。
- `useEffect` 同步 `initial.fillPolicy` 时：`full` → 显示并默认选中 **`hidden`**（PRD 锁定；与 worktree 默认 fill 一致）。
- `handleSave`：`fillPolicy` 不得为 `full`；若 state 异常则 coalesce 为 `hidden`。
- `dirRuleToForm`（`worktree-operations.service.ts`）读入时同样映射，避免 Sheet 打开空白 chip。

---

## 最终项目结构

```
apps/mobile/src/
  db/
    connection.ts              # + getMobileDatabaseFilePath()
  storage/
    app-version-guard.ts       # NEW: version → richRenderEpoch
  services/
    db-backup.service.ts       # NEW: export/import full DB
  components/chat/
    MessageActionMenu.tsx      # vertical scroll layout
    MessageList.tsx            # extraData + renderKey
    message-edit.ts            # (unchanged items)
  screens/stack/
    ProviderCreateScreen.tsx   # navigation/toast fix
    ProvidersScreen.tsx        # lighter reload
    ProviderDetailScreen.tsx   # optional sampling count
  screens/tabs/
    ProfileTabScreen.tsx       # data management entries
  components/sheet/
    DirectoryRuleSheet.tsx     # drop full fill
packages/core/
  (no change for fill policy semantics)
```

---

## 变更点清单

| 文件 | 变更 |
|------|------|
| `ProviderCreateScreen.tsx` | 保存成功：Toast + 单一导航路径，移除 Alert 内 replace |
| `ProvidersScreen.tsx` | `reload` 去掉 per-model `getProfile` 循环 |
| `MessageActionMenu.tsx` | 纵向 ScrollView + maxHeight |
| `app-version-guard.ts` | 新建；KKV 键 `app.lastRunVersion` / `app.richRenderEpoch` |
| `MessageList.tsx` | `extraData`、`renderKey` 传给 `RichContentBody` |
| `RichContentBody.tsx` | 接受 `renderKey`，传给 `RenderHTML` 的 `key` |
| `novel-master-context.tsx` | 启动时调用 version guard；导出 `rebootstrap` 或复用 `retry` |
| `db/connection.ts` | `getMobileDatabaseFilePath`；导出前 checkpoint |
| `db-backup.service.ts` | export/import |
| `ProfileTabScreen.tsx` | 导出入口 + 确认对话框 |
| `DirectoryRuleSheet.tsx` | 移除 full；映射历史 full |
| `worktree-operations.service.ts` | `dirRuleToForm` 映射 `full` → `hidden` |
| `app-ui-keys.ts` | 可选：`APP_UI_KEY_LAST_RUN_VERSION` |

---

## 详细实现步骤

### 步骤 1：目录规则（最小，可先做）

1. 修改 `FILL_POLICIES` 与 `dirRuleToForm` 的 `full` 映射。
2. 手测：历史 `full` 目录打开 Sheet 显示「不展示」；保存后 DB 为 `hidden`。

### 步骤 2：消息长按菜单

1. 重构 `MessageActionMenu` 布局与样式。
2. 更新/新增 `__tests__/message-action-menu.test.tsx`（若无则新建）断言 6 项时 ScrollView 存在。

### 步骤 3：富文本版本 Remount

1. 实现 `app-version-guard.ts`，在 `NovelMasterProvider` bootstrap 成功后调用。
2. 将 `richRenderEpoch` 经 context 或 module singleton 传入 `ChatTabScreen` → `MessageList`。
3. `RichContentBody` 增加 `key={renderKey}`。

### 步骤 4：服务商创建稳定性

1. 改 `ProviderCreateScreen` 成功路径。
2. 精简 `ProvidersScreen.reload`。
3. 真机：创建 2 个服务商 + 10 分钟随意操作（PRD）。

### 步骤 5：数据库导出/导入

1. `getMobileDatabaseFilePath` + WAL checkpoint。
2. `exportDatabaseBackup` / `importDatabaseBackup`。
3. `ProfileTabScreen` 接线；导入后 `retry()`。
4. 手测：导出 → 卸载 → 安装 → 导入 → 数据恢复。

### 步骤 6：集成与发布

1. `npm test -w @novel-master/mobile` + core agent 相关不受影响。
2. `npm run build` + `assembleRelease`。

---

## 测试策略

### 自动化

| ID | 范围 | 用例 |
|----|------|------|
| T1 | `message-edit` | `buildMessageActionItems` 项数与 role/hidden 分支（已有） |
| T2 | `MessageActionMenu` | 渲染 6 项，存在 `ScrollView`（react-test-renderer） |
| T3 | `app-version-guard` | 版本不变 epoch 不变；版本变 epoch+1 |
| T4 | `dirRuleToForm` / Sheet | `full` 映射为 `hidden`（纯函数测 `normalizeFillPolicyForMobile`） |
| T5 | `db-backup` | mock fs：`export` 调用 checkpoint + copy；`import` 调用 close + copy + 非法文件拒绝 |
| T6 | `ProvidersScreen` | 可选：mock runtime，断言 `reload` 不调用 `getProfile` |

### 手工（Android）

| ID | PRD 对应 |
|----|----------|
| M1 | 服务商创建 10 分钟无崩溃 |
| M2 | 小屏长按 6 项均可点 |
| M3 | 覆盖安装后打开富文本会话无 DOM 红屏 |
| M4–M5 | 全库导出/导入/取消/坏文件 |
| M6 | 目录规则无「全文本」 |

---

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| DB 导入半失败导致无法启动 | 导入前复制当前库到 `*.nmbackup.bak`；失败不覆盖原文件 | 恢复 bak 文件 |
| 导入时未关闭 WAL | 必须 checkpoint + close connection | — |
| Provider 列表少显示采样数 | 详情页仍展示 | 恢复 getProfile 循环 |
| Remount 富文本性能 | 仅 version 变化时 epoch+1 | 移除 renderKey |
| `getDbPath` API 差异 | 双路径回退 | 硬编码 DatabasesDir |

**分支建议**：`fix/mobile-stability-db-migration`

**回滚**：按文件 revert；DB 导入功能独立提交便于 cherry-pick。

---

## 与 PRD 完成矩阵

| PRD 章节 | SPEC 落点 |
|----------|-----------|
| §1 服务商闪退 | 步骤 4、ProvidersScreen 减负、Create 导航 |
| §2 长按菜单 | 步骤 2、MessageActionMenu 纵向滚动 |
| §3 覆盖安装 | 步骤 3、richRenderEpoch |
| §4–5 DB 迁移 | 步骤 5、db-backup.service |
| §6 目录规则 | 步骤 1、FILL_POLICIES + 映射 |

确认本 SPEC 后再进入编码。

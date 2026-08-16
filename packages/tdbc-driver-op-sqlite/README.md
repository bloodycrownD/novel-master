# @novel-master/tdbc-driver-op-sqlite

移动端 TDBC 驱动，基于 [@op-engineering/op-sqlite](https://github.com/op-engineering/op-sqlite)（peer dependency），替代已废弃的 react-native-quick-sqlite。

## 入口

| Import | 何时使用 |
|--------|----------|
| `@novel-master/tdbc-driver-op-sqlite` | Node 测试、CI conformance、文档（默认 adapter 用**动态** `import()`） |
| `@novel-master/tdbc-driver-op-sqlite/native` | **RN App / Metro** —— 静态 op-sqlite 绑定（`NativeOpSqliteAdapter`） |

React Native 应用应从 **`/native`** import，让 Metro 把 peer 打进 bundle。

## 布局（契约 + 实现）

```text
adapter.ts                        # 契约: OpSqliteAdapter
impl/
  op-sqlite.adapter.ts            # BaseOpSqliteAdapter（共享 open/execute 路由 + metadata 转换）
  op-sqlite-dynamic.adapter.ts    # OpSqliteDynamicAdapter —— 主入口默认
  op-sqlite-native.adapter.ts     # NativeOpSqliteAdapter —— /native 默认
driver.ts / connection.ts         # TDBC op-sqlite 驱动（driver.ts 不 import impl/）
```

`driver.ts` 不 import `impl/`；`index.ts` 与 `native.ts` 各自选择默认 adapter。

## 与 quick-sqlite 版（tdbc-driver-rn）的差异

- op-sqlite 是**连接对象模型**：`open()` 返回 `DB` 实例，`execute`（异步）/`executeSync`（同步）都是实例方法（注意命名与 quick-sqlite 正好**反转**）。
- `metadata` 字段 `{name, type, index}` 在 adapter 层统一转换为契约的 `{columnName}`。
- `OpSqliteDriver.open` 追加 `PRAGMA temp_store = MEMORY`（运行期兜底编译 flag `SQLITE_TEMP_STORE=2`，防 Android 12 及以下临时目录不可写导致大事务 disk I/O error，见 op-sqlite issue #137）。
- 存量库兼容：优先探测旧 quick-sqlite 布局（Android `<files>/default/<name>`、iOS `<DocumentDir>/default/<name>`），以绝对路径 + `failOnCreate: true` 原地打开旧文件；失败则落回 op-sqlite 默认布局。

## 使用（Node / 文档）

```typescript
import { open } from "@novel-master/core";
import { registerOpSqliteDriver } from "@novel-master/tdbc-driver-op-sqlite";

registerOpSqliteDriver();

const conn = await open("tdbc:sqlite:file:novel_master_vfs", { driver: "op-sqlite" });
```

## 使用（RN App）

```typescript
import { registerOpSqliteDriver } from "@novel-master/tdbc-driver-op-sqlite/native";

registerOpSqliteDriver();
```

## 真机手动验收清单

- [ ] 打开设备/模拟器上的文件数据库，`getDbPath()` 日志核对实际路径
- [ ] 存量 quick-sqlite 库文件原地打开（路径不变、行数守恒）
- [ ] INSERT / SELECT 往返（含 blob）
- [ ] `transaction` 出错回滚
- [ ] `batch` 约 10 组参数
- [ ] `close` 后调用 → `CONNECTION_CLOSED`

CI 在 Node 里用 `MockOpSqliteAdapter` 跑 conformance；真实 op-sqlite 行为按上面清单在真机验证。

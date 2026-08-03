# 全局配置系统 技术规格（SPEC）

> **Superseded**：由 `Iterations/persistent-state-and-preferences/spec.md` 承接。

## 设计目标

基于现有 KKV 系统实现应用级全局配置管理，完全替换 `config.json`，统一配置存储与访问接口，支持类型化读写（string/boolean/number）。

## 总体方案

### 架构分层

```
CLI 层 (apps/cli)
  ├─ nm config <set|get|list|reset>  # 新增配置命令
  ├─ runtime.ts                       # 替换 config.json 读写为 ConfigService
  └─ CliScopeResolver                 # 从 ConfigService 读取 current* 字段

Service 层 (packages/core)
  └─ ConfigService                    # 新增配置服务
      ├─ get/set/getBoolean/setBoolean/getNumber/setNumber
      ├─ list/reset
      └─ 基于 KkvService (module: "global-config")

存储层
  └─ kkv_entry 表 (module="global-config", key=配置项名, value=字符串)
```

### 配置项设计

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `currentProjectId` | string | - | 当前项目 ID |
| `currentSessionId` | string | - | 当前会话 ID |
| `currentProviderId` | string | - | 当前 provider ID |
| `currentModelId` | string | - | 当前 model ID |
| `session-fs.versionCheck` | boolean | `true` | session-fs 是否启用版本校验 |

### 类型化方法设计

```typescript
interface ConfigService {
  // 字符串类型（基础方法）
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  
  // 布尔类型
  getBoolean(key: string, defaultValue?: boolean): Promise<boolean>;
  setBoolean(key: string, value: boolean): Promise<void>;
  
  // 数字类型
  getNumber(key: string, defaultValue?: number): Promise<number>;
  setNumber(key: string, value: number): Promise<void>;
  
  // 通用操作
  list(): Promise<Array<{ key: string; value: string }>>;
  reset(key: string): Promise<void>;
}
```

**设计说明**：
- `get/set` 是字符串操作的基础方法，无需额外的 `getString/setString`
- `getBoolean/setBoolean` 和 `getNumber/setNumber` 提供类型化便利方法
- 所有值在 KKV 中以字符串存储，类型化方法负责转换

**类型转换规则**：
- `getBoolean`: `"true"` → `true`, `"false"` → `false`, 其他 → `defaultValue` 或抛错
- `setBoolean`: `true` → `"true"`, `false` → `"false"`
- `getNumber`: 解析为数字，失败 → `defaultValue` 或抛错
- `setNumber`: 转为字符串存储

## 最终项目结构

```
packages/core/src/
  ├─ service/config/
  │   ├─ config.port.ts              # ConfigService 接口
  │   ├─ impl/config.service.ts      # 基于 KKV 的实现
  │   └─ create-config-service.ts    # 工厂函数
  ├─ errors/config-errors.ts         # ConfigError 类型
  └─ index.ts                        # 导出 ConfigService

apps/cli/src/
  ├─ config/
  │   ├─ cli-config.ts               # 删除（整个文件）
  │   ├─ cli-config-errors.ts        # 删除（整个文件）
  │   ├─ resolve-scope.ts            # 修改：从 ConfigService 读取
  │   └─ resolve-provider-scope.ts   # 修改：从 ConfigService 读取
  ├─ config-cmd/
  │   └─ commands.ts                 # 新增：nm config CLI 实现
  ├─ runtime.ts                      # 修改：移除 config.json 逻辑
  ├─ main.ts                         # 修改：路由 config 命令
  └─ session/commands.ts             # 修改：从 ConfigService 读取 versionCheck

apps/cli/test/
  └─ helpers.ts                      # 修改：移除 readCliConfig
```

## 变更点清单

### 1. Core 层新增

#### `packages/core/src/service/config/config.port.ts`
```typescript
export interface ConfigService {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  getBoolean(key: string, defaultValue?: boolean): Promise<boolean>;
  setBoolean(key: string, value: boolean): Promise<void>;
  getNumber(key: string, defaultValue?: number): Promise<number>;
  setNumber(key: string, value: number): Promise<void>;
  list(): Promise<Array<{ key: string; value: string }>>;
  reset(key: string): Promise<void>;
}
```

#### `packages/core/src/service/config/impl/config.service.ts`
```typescript
export class DefaultConfigService implements ConfigService {
  private readonly MODULE = "global-config";
  
  constructor(private readonly kkv: KkvService) {}
  
  async get(key: string): Promise<string | undefined> {
    try {
      return await this.kkv.get(this.MODULE, key);
    } catch (error) {
      if (error instanceof KkvError && error.code === "NOT_FOUND") {
        return undefined;
      }
      throw error;
    }
  }
  
  async getBoolean(key: string, defaultValue = false): Promise<boolean> {
    const value = await this.get(key);
    if (value === undefined) return defaultValue;
    if (value === "true") return true;
    if (value === "false") return false;
    throw configInvalidType(key, "boolean", value);
  }
  
  async setBoolean(key: string, value: boolean): Promise<void> {
    await this.set(key, value ? "true" : "false");
  }
  
  // ... 其他方法实现
}
```

#### `packages/core/src/errors/config-errors.ts`
```typescript
export type ConfigErrorCode = "INVALID_TYPE";

export class ConfigError extends Error {
  readonly code: ConfigErrorCode;
  readonly key?: string;
  
  constructor(code: ConfigErrorCode, message: string, options?: { key?: string }) {
    super(message);
    this.name = "ConfigError";
    this.code = code;
    this.key = options?.key;
  }
}

export function configInvalidType(key: string, expectedType: string, actualValue: string): ConfigError {
  return new ConfigError(
    "INVALID_TYPE",
    `Config key "${key}" expected ${expectedType}, got: ${actualValue}`,
    { key }
  );
}
```

### 2. CLI 层修改

#### `apps/cli/src/runtime.ts`
**删除**：
- `loadCliConfig` / `saveCliConfig` 调用
- `configPath` 字段
- `setCliContext` 方法（替换为 `config.set`）

**新增**：
- `readonly config: ConfigService`
- 初始化：`config: createConfigService(createKkvService(conn))`

**修改**：
```typescript
export interface NovelMasterRuntime {
  readonly conn: TdbcConnection;
  readonly kkv: KkvService;
  readonly config: ConfigService;  // 新增
  // 删除 configPath
  // 删除 setCliContext
  // ... 其他字段保持不变
}
```

#### `apps/cli/src/config/resolve-scope.ts`
**修改**：
```typescript
export class CliScopeResolver {
  constructor(private readonly config: ConfigService) {}
  
  async resolveProjectId(flags: ReadonlyMap<string, string | true>): Promise<string> {
    const fromFlag = flagString(flags, "project");
    if (fromFlag != null) return fromFlag;
    
    const fromConfig = await this.config.get("currentProjectId");
    if (fromConfig != null) return fromConfig;
    
    throw new Error("Missing --project <id> (or run: nm project use --project <id>)");
  }
  
  // 类似修改 resolveSessionId
}
```

#### `apps/cli/src/config-cmd/commands.ts`（新增）
```typescript
export async function runConfig(
  config: ConfigService,
  subcommand: string,
  args: readonly string[]
): Promise<void> {
  const { flags } = parseCliArgs(args);
  
  switch (subcommand) {
    case "set": {
      const key = flags.get("key");
      const value = flags.get("value");
      if (typeof key !== "string" || typeof value !== "string") {
        throw new Error("Usage: nm config set --key <k> --value <v>");
      }
      await config.set(key, value);
      return;
    }
    case "get": {
      const key = flags.get("key");
      if (typeof key !== "string") {
        throw new Error("Usage: nm config get --key <k>");
      }
      const value = await config.get(key);
      console.log(value ?? "");
      return;
    }
    case "list": {
      const entries = await config.list();
      for (const { key, value } of entries) {
        console.log(`${key}\t${value}`);
      }
      return;
    }
    case "reset": {
      const key = flags.get("key");
      if (typeof key !== "string") {
        throw new Error("Usage: nm config reset --key <k>");
      }
      await config.reset(key);
      return;
    }
    default:
      throw new Error("Usage: nm config <set|get|list|reset> ...");
  }
}
```

#### `apps/cli/src/session/commands.ts`
**修改** `runSessionVfs`：
```typescript
async function runSessionVfs(deps: SessionDeps, args: readonly string[]): Promise<void> {
  // ... 现有逻辑
  
  if (group === "write") {
    const versionCheck = await deps.config.getBoolean("session-fs.versionCheck", true);
    await runWrite(vfs, subArgs, { defaultNoVersionCheck: !versionCheck });
    return;
  }
  
  // ... 其他命令
}
```

### 3. 迁移逻辑（可选，首次运行时）

在 `runtime.ts` 的 `createNovelMasterRuntime` 中：
```typescript
// 检测旧 config.json 并迁移
const legacyConfigPath = resolveConfigPath(dbPath);
try {
  const legacyConfig = await loadCliConfig(legacyConfigPath);
  if (Object.keys(legacyConfig).length > 0) {
    // 迁移到 KKV
    for (const [key, value] of Object.entries(legacyConfig)) {
      if (value != null) {
        await config.set(key, value);
      }
    }
    // 删除旧文件
    await unlink(legacyConfigPath);
  }
} catch {
  // 忽略迁移错误
}
```

**注**：考虑到复杂性，**v1 不实现自动迁移**，要求用户手动重新设置配置项。

## 详细实现步骤

### Phase 1: Core 层实现（packages/core）

1. **创建 ConfigService 接口**
   - 文件：`src/service/config/config.port.ts`
   - 定义 `ConfigService` 接口（8 个方法）

2. **实现 DefaultConfigService**
   - 文件：`src/service/config/impl/config.service.ts`
   - 基于 `KkvService`，module 固定为 `"global-config"`
   - 实现类型转换逻辑（boolean/number）

3. **创建工厂函数**
   - 文件：`src/service/config/create-config-service.ts`
   - `createConfigService(kkv: KkvService): ConfigService`

4. **定义 ConfigError**
   - 文件：`src/errors/config-errors.ts`
   - `ConfigError` 类 + `configInvalidType` 工厂函数

5. **导出到 index.ts**
   - 添加：`export { ConfigError, createConfigService, type ConfigService }`

6. **编译验证**
   - `npm run build`

### Phase 2: CLI 层重构（apps/cli）

7. **修改 runtime.ts**
   - 删除 `configPath`、`setCliContext`
   - 新增 `config: ConfigService`
   - 初始化：`config: createConfigService(createKkvService(conn))`

8. **修改 CliScopeResolver**
   - 构造函数改为接收 `ConfigService`
   - `resolveProjectId` / `resolveSessionId` 改为异步，从 `config.get` 读取
   - 删除 `getConfigSnapshot` / `replaceConfig`

9. **修改 resolve-provider-scope.ts**
   - 类似 `CliScopeResolver`，改为从 `ConfigService` 读取

10. **删除旧文件**
    - 删除 `src/config/cli-config.ts`
    - 删除 `src/config/cli-config-errors.ts`

11. **新增 config 命令**
    - 文件：`src/config-cmd/commands.ts`
    - 实现 `runConfig` 函数（set/get/list/reset）

12. **修改 main.ts**
    - 路由 `config` 子命令到 `runConfig`

13. **修改 session/commands.ts**
    - `runSessionVfs` 中读取 `session-fs.versionCheck` 配置

14. **修改 project/commands.ts**
    - `use` 命令改为调用 `config.set("currentProjectId", id)`
    - `delete` 命令改为调用 `config.reset("currentProjectId")`

15. **修改 provider/commands.ts**
    - 类似 project，改为 `config.set/reset`

16. **修改 model/commands.ts**
    - 类似 provider

### Phase 3: 测试与验证

17. **单元测试（packages/core）**
    - 文件：`test/config/config.service.test.ts`
    - 测试用例：
      - `get/set` 基本操作
      - `getBoolean` 类型转换（"true"/"false"/invalid）
      - `getNumber` 类型转换（"123"/invalid）
      - `list` 列出所有配置
      - `reset` 删除配置项

18. **E2E 测试（apps/cli）**
    - 文件：`test/config-e2e.test.ts`
    - 测试用例：
      - `nm config set/get/list/reset`
      - `nm project use` 后 `nm config get currentProjectId`
      - `nm config set session-fs.versionCheck false` 后 `nm session vfs write` 不校验版本

19. **修改现有测试**
    - `test/helpers.ts`：删除 `readCliConfig`
    - `test/provider-e2e.test.ts`：改为调用 `nm config get currentProviderId`

20. **手动验证**
    - 删除旧 `.novel-master/config.json`
    - 执行 `nm config set currentProjectId test`
    - 执行 `nm config get currentProjectId`，验证输出 `test`
    - 执行 `nm config set session-fs.versionCheck false`
    - 执行 `nm session vfs write /test.md --text "content"`（version 不匹配场景），验证不报错

## 测试策略

### 单元测试（packages/core）

**文件**：`packages/core/test/config/config.service.test.ts`

```typescript
describe("ConfigService", () => {
  it("sets and gets string values", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.config.set("key1", "value1");
    assert.equal(await ctx.config.get("key1"), "value1");
    await ctx.conn.close();
  });

  it("returns undefined for missing keys", async () => {
    const ctx = await openNovelMasterTestConnection();
    assert.equal(await ctx.config.get("missing"), undefined);
    await ctx.conn.close();
  });

  it("sets and gets boolean values", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.config.setBoolean("flag", true);
    assert.equal(await ctx.config.getBoolean("flag"), true);
    await ctx.config.setBoolean("flag", false);
    assert.equal(await ctx.config.getBoolean("flag"), false);
    await ctx.conn.close();
  });

  it("uses default value for missing boolean", async () => {
    const ctx = await openNovelMasterTestConnection();
    assert.equal(await ctx.config.getBoolean("missing", true), true);
    await ctx.conn.close();
  });

  it("throws on invalid boolean value", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.config.set("bad", "not-a-bool");
    await assert.rejects(
      () => ctx.config.getBoolean("bad"),
      (e: unknown) => e instanceof ConfigError && e.code === "INVALID_TYPE"
    );
    await ctx.conn.close();
  });

  it("sets and gets number values", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.config.setNumber("count", 42);
    assert.equal(await ctx.config.getNumber("count"), 42);
    await ctx.conn.close();
  });

  it("lists all config entries", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.config.set("a", "1");
    await ctx.config.set("b", "2");
    const list = await ctx.config.list();
    assert.deepEqual(list.sort((x, y) => x.key.localeCompare(y.key)), [
      { key: "a", value: "1" },
      { key: "b", value: "2" },
    ]);
    await ctx.conn.close();
  });

  it("resets a config key", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.config.set("temp", "value");
    await ctx.config.reset("temp");
    assert.equal(await ctx.config.get("temp"), undefined);
    await ctx.conn.close();
  });
});
```

### E2E 测试（apps/cli）

**文件**：`apps/cli/test/config-e2e.test.ts`

```typescript
describe("config CLI", () => {
  it("set/get/list/reset workflow", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-config-"));
    const dbPath = join(dir, "novel.db");
    
    try {
      runCli(["config", "set", "--key", "k1", "--value", "v1", "--db", dbPath]);
      const get = runCli(["config", "get", "--key", "k1", "--db", dbPath]);
      assert.equal(get.stdout.trim(), "v1");
      
      const list = runCli(["config", "list", "--db", dbPath]);
      assert.ok(list.stdout.includes("k1\tv1"));
      
      runCli(["config", "reset", "--key", "k1", "--db", dbPath]);
      const getAfter = runCli(["config", "get", "--key", "k1", "--db", dbPath]);
      assert.equal(getAfter.stdout.trim(), "");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("session-fs.versionCheck disables version check", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-vcheck-"));
    const dbPath = join(dir, "novel.db");
    
    try {
      // 创建 project + session
      const pj = runCli(["project", "create", "--title", "p", "--db", dbPath]);
      const projectId = pj.stdout.trim();
      const sess = runCli(["session", "create", "--project", projectId, "--db", dbPath]);
      const sessionId = sess.stdout.trim();
      
      // 写入文件
      runCli(["session", "vfs", "write", "/test.md", "--text", "v1", "--project", projectId, "--session", sessionId, "--db", dbPath]);
      
      // 关闭 versionCheck
      runCli(["config", "set", "--key", "session-fs.versionCheck", "--value", "false", "--db", dbPath]);
      
      // 不带 --version 再次写入（应该成功）
      const write2 = runCli(["session", "vfs", "write", "/test.md", "--text", "v2", "--project", projectId, "--session", sessionId, "--db", dbPath]);
      assert.equal(write2.status, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

## 风险与回滚方案

### 风险点

1. **破坏性变更**：删除 `config.json` 后，旧版本 CLI 无法读取配置
   - **缓解**：在 README 中明确标注为 breaking change
   - **回滚**：恢复 `cli-config.ts` 并回退 commit

2. **异步化影响**：`CliScopeResolver` 方法改为异步，调用方需要 `await`
   - **缓解**：编译时会报错，强制修改所有调用点
   - **验证**：运行 `npm run build` 和全量测试

3. **类型转换错误**：`getBoolean/getNumber` 遇到非法值时抛错
   - **缓解**：提供 `defaultValue` 参数，避免抛错
   - **测试**：覆盖非法值场景

4. **迁移数据丢失**：用户升级后需要重新设置配置
   - **缓解**：在 CHANGELOG 中提供迁移指南（手动执行 `nm config set` 命令）
   - **可选**：实现自动迁移逻辑（Phase 4）

### 回滚方案

**场景 1**：Core 层实现有 bug
- 回滚 `packages/core/src/service/config/` 目录
- 回滚 `packages/core/src/errors/config-errors.ts`
- 回滚 `packages/core/src/index.ts` 的导出

**场景 2**：CLI 层重构导致功能异常
- 恢复 `apps/cli/src/config/cli-config.ts`
- 恢复 `apps/cli/src/runtime.ts` 的 `configPath` 和 `setCliContext`
- 删除 `apps/cli/src/config-cmd/`

**场景 3**：测试失败率高
- 暂停合并，修复失败用例
- 补充缺失的测试场景

### 验收检查清单

- [ ] `npm run build` 成功（core + cli）
- [ ] `npm test` 全部通过（core + cli）
- [ ] 手动验证：`nm config set/get/list/reset`
- [ ] 手动验证：`nm project use` 后配置生效
- [ ] 手动验证：`session-fs.versionCheck=false` 时跳过版本校验
- [ ] 手动验证：`.novel-master/config.json` 不再存在
- [ ] 代码审查：确认所有 `config.json` 引用已删除
- [ ] 文档更新：README 中说明 breaking change

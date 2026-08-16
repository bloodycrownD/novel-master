/**
 * op-sqlite TDBC 驱动（@op-engineering/op-sqlite 或注入的 adapter）。
 *
 * @module tdbc-driver-op-sqlite/driver
 */

import type { OpenOptions, TdbcConnection, TdbcDriver } from "@novel-master/core";
import { TdbcError } from "@novel-master/core";
import type { OpSqliteAdapter } from "./adapter.js";
import { OpSqliteConnection } from "./connection.js";

export const OPSQLITE_DRIVER_NAME = "op-sqlite";

/** op-sqlite 驱动专属 open 选项（测试可注入 adapter）。 */
export interface OpSqliteOpenOptions extends OpenOptions {
  adapter?: OpSqliteAdapter;
  /** 传给 op-sqlite `open` 的数据库文件名（不带扩展名，文件也不带后缀）。 */
  dbName?: string;
  location?: string;
}

export class OpSqliteDriver implements TdbcDriver {
  readonly name = OPSQLITE_DRIVER_NAME;
  private readonly defaultAdapter: OpSqliteAdapter;

  /**
   * @param defaultAdapter - 必传；入口模块（{@link index.ts}、{@link native.ts}）注入 impl。
   */
  constructor(defaultAdapter: OpSqliteAdapter) {
    this.defaultAdapter = defaultAdapter;
  }

  async open(options: OpSqliteOpenOptions & { url?: string }): Promise<TdbcConnection> {
    const adapter = options.adapter ?? this.defaultAdapter;
    const name = options.dbName ?? options.filename ?? "default";

    try {
      // 存量库文件探测：优先尝试旧 quick-sqlite 布局的绝对路径目录。
      // op-sqlite 的 open 语义（已从原生源码核实）：location 为绝对路径时
      // 最终文件为 `<location>/<name>`，不改写文件名、不加 .db 后缀——
      // 打开的就是旧文件本体。failOnCreate: true 确保旧文件不存在时抛错
      // 而非新建空库（新建空库会掩盖旧数据，等于「升级丢库」）。
      const legacyDir = adapter.getLegacyDefaultDir?.();
      if (legacyDir && !options.location && name !== ":memory:") {
        try {
          await adapter.open({ name, location: legacyDir, failOnCreate: true });
          return await this.finishOpen(adapter);
        } catch {
          // 旧文件不存在（新装用户）或绝对路径打开失败：落回默认布局。
        }
      }

      await adapter.open({ name, location: options.location });
      return await this.finishOpen(adapter);
    } catch (cause) {
      throw new TdbcError("SQLITE_ERROR", "Failed to open database", {
        driver: this.name,
        cause,
      });
    }
  }

  /** open 成功后的公共收尾：路径日志（真机验证证据）+ PRAGMA 初始化。 */
  private async finishOpen(adapter: OpSqliteAdapter): Promise<OpSqliteConnection> {
    const dbPath = adapter.getDbPath?.();
    if (dbPath) {
      console.log(`[op-sqlite-tdbc] 数据库文件实际路径: ${dbPath}`);
    }
    // 显式开启 foreign_keys：op-sqlite / quick-sqlite 默认 off，
    // 不开的话 mobile 端 ON DELETE CASCADE 形同虚设。
    await adapter.execute("PRAGMA foreign_keys = ON");
    // 运行期兜底编译 flag SQLITE_TEMP_STORE=2：Android 12 及以下部分设备
    // 临时目录不可写，大事务会报 disk I/O error（op-sqlite issue #137）。
    // 即使编译 flag 因 monorepo 配置位置问题静默未生效，这里也能兜住。
    await adapter.execute("PRAGMA temp_store = MEMORY");
    return new OpSqliteConnection(adapter);
  }
}

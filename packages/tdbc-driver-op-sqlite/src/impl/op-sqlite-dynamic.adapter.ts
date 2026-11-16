/**
 * 默认 {@link OpSqliteAdapter}：惰性动态加载 @op-engineering/op-sqlite。
 *
 * @module tdbc-driver-op-sqlite/impl/op-sqlite-dynamic.adapter
 * @remarks 使用命名导出 `open` + 平台路径常量；execute/executeSync 都在 open 返回的 DB 实例上。
 */

import type { OpSqliteAdapter, OpSqliteResult } from "../adapter.js";
import {
  BaseOpSqliteAdapter,
  type OpSqliteBindings,
} from "./op-sqlite.adapter.js";

async function loadOpSqlite(): Promise<OpSqliteBindings> {
  try {
    const mod = (await import(
      "@op-engineering/op-sqlite"
    )) as unknown as Partial<OpSqliteBindings>;
    if (typeof mod.open !== "function") {
      // nm-throw: keep — 第三方驱动模块契约边界：op-sqlite 导出缺失属依赖装配失败。
      throw new Error("@op-engineering/op-sqlite 导出缺失（需要 open）");
    }
    return mod as OpSqliteBindings;
  } catch (cause) {
    // nm-throw: keep — 第三方驱动加载边界：op-sqlite 未安装/加载失败，交装配层处理。
    throw new Error(
      "@op-engineering/op-sqlite 未安装或加载失败。请将其安装为 peer 依赖并重新构建原生应用。",
      { cause },
    );
  }
}

/**
 * 动态加载 op-sqlite 的薄封装（Node 测试 / 文档入口用）。
 */
export class OpSqliteDynamicAdapter implements OpSqliteAdapter {
  private delegate?: BaseOpSqliteAdapter;

  async open(options: {
    name: string;
    location?: string;
    failOnCreate?: boolean;
  }): Promise<void> {
    const bindings = await loadOpSqlite();
    this.delegate = new BaseOpSqliteAdapter(bindings);
    await this.delegate.open(options);
  }

  async close(): Promise<void> {
    await this.delegate?.close();
    this.delegate = undefined;
  }

  async execute(sql: string, params?: unknown[]): Promise<OpSqliteResult> {
    const delegate = this.requireDelegate();
    return delegate.execute(sql, params);
  }

  executeSync(sql: string, params?: unknown[]): OpSqliteResult {
    const delegate = this.requireDelegate();
    return delegate.executeSync(sql, params);
  }

  getLegacyDefaultDir(): string | undefined {
    return this.delegate?.getLegacyDefaultDir();
  }

  getDbPath(): string | undefined {
    return this.delegate?.getDbPath();
  }

  private requireDelegate(): BaseOpSqliteAdapter {
    if (!this.delegate) {
      // nm-throw: keep — 驱动层 API 误用不变量：未 open 即调用属编程错误。
      throw new Error("Adapter not open");
    }
    return this.delegate;
  }
}

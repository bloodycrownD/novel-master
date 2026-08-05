import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

import {
  bootstrapNovelMaster,
  open,
} from "@novel-master/core";
import type { TdbcConnection } from "@novel-master/core/tdbc";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";

// 注册 react-native 桩模块钩子，必须在动态导入 store 之前完成。
register(new URL("./rn-mock-hook.mjs", import.meta.url));

const { createAndroidSecretStore } = await import("../src/android-secret-store.ts");

const ALGO = "android-keystore-aes-gcm-v1";

/** 注入假的 SkspModule，加解密走纯 JS 的 base64 直通，便于核对写入与读出。 */
function installSkspStub(): { calls: number } {
  const state = { calls: 0 };
  const stub = {
    async encrypt(_ref: string, plain: string) {
      state.calls++;
      // 简单 base64 包装，方便测试断言
      return {
        ciphertext: Buffer.from(plain, "utf8").toString("base64"),
        iv: Buffer.alloc(12, 0).toString("base64"),
      };
    },
    async decrypt(_ref: string, ciphertextB64: string) {
      state.calls++;
      return Buffer.from(ciphertextB64, "base64").toString("utf8");
    },
  };
  const g = globalThis as unknown as {
    __RN_NATIVE_MODULES__?: Record<string, unknown>;
  };
  // 注意：桩模块的 NativeModules 在初次 import 时绑定到 globalThis 上的对象，
  // 这里必须 mutate 同一个对象，不能换新引用，否则 native.ts 拿不到 SkspModule。
  if (!g.__RN_NATIVE_MODULES__) {
    g.__RN_NATIVE_MODULES__ = {};
  }
  g.__RN_NATIVE_MODULES__.SkspModule = stub;
  return state;
}

describe("AndroidSecretStore", () => {
  before(() => {
    registerBetterSqlite3Driver();
  });

  it("set/get 来回一致，且 SELECT 现在能带出 version 列（与 mac/windows 对齐）", async () => {
    installSkspStub();
    const conn = await open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    });
    await bootstrapNovelMaster(conn);
    try {
      const store = createAndroidSecretStore(conn);
      const ref = "provider/test/apiKey";
      const plain = "sk-secret-123";
      await store.set(ref, plain);
      assert.equal(await store.get(ref), plain);
      assert.equal(await store.has(ref), true);

      const rows = await conn.query<{
        algo: string;
        version: number;
        ciphertext: Uint8Array;
      }>("SELECT algo, version, ciphertext FROM sksp_secrets WHERE ref = ?", [ref]);
      assert.equal(rows[0]!.algo, ALGO);
      assert.equal(rows[0]!.version, 1);
      assert.notEqual(
        Buffer.from(rows[0]!.ciphertext).toString("utf8"),
        plain,
      );

      assert.equal(await store.delete(ref), true);
      assert.equal(await store.get(ref), null);
    } finally {
      await closeQuietly(conn);
    }
  });

  // T-DS6：当行里 version != 1（未来 schema 升级）时，get() 仍应能正确解密，
  // 这条用例专门钉住 Android 的 SELECT 已把 version 列读出来。
  it("version=2 时 get() 仍能读出明文（T-DS6 回归保护）", async () => {
    installSkspStub();
    const conn = await open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    });
    await bootstrapNovelMaster(conn);
    try {
      const ref = "provider/v2/apiKey";
      const plain = "sk-v2-plain";
      // 用与 set() 等价的加密桩产物直接写入，并把 version 置成 2，
      // 模拟未来 schema 升级后磁盘上既有的行。
      const ciphertext = Buffer.from(plain, "utf8").toString("base64");
      const iv = Buffer.alloc(12, 0).toString("base64");
      await conn.execute(
        `INSERT INTO sksp_secrets (ref, ciphertext, iv, algo, version, updated_at_ms)
         VALUES (?, ?, ?, ?, 2, ?)`,
        [ref, Buffer.from(ciphertext, "base64"), Buffer.from(iv, "base64"), ALGO, Date.now()],
      );

      const store = createAndroidSecretStore(conn);
      assert.equal(await store.get(ref), plain);

      // 顺便确认读出来的行里 version 列就是 2，证明 SELECT 确实把它取出来了。
      const rows = await conn.query<{ version: number }>(
        "SELECT version FROM sksp_secrets WHERE ref = ?",
        [ref],
      );
      assert.equal(rows[0]!.version, 2);
    } finally {
      await closeQuietly(conn);
    }
  });

  it("拒绝 algo 不匹配的行", async () => {
    installSkspStub();
    const conn = await open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    });
    await bootstrapNovelMaster(conn);
    try {
      const ref = "provider/wrong/algo";
      await conn.execute(
        `INSERT INTO sksp_secrets (ref, ciphertext, iv, algo, version, updated_at_ms)
         VALUES (?, ?, ?, ?, 1, ?)`,
        [ref, Buffer.from("x"), Buffer.alloc(12), "macos-keychain-aes-gcm-v1", Date.now()],
      );
      const store = createAndroidSecretStore(conn);
      await assert.rejects(() => store.get(ref));
    } finally {
      await closeQuietly(conn);
    }
  });
});

async function closeQuietly(conn: TdbcConnection): Promise<void> {
  try {
    await conn.close();
  } catch {
    // 忽略关闭错误，不掩盖真正的失败
  }
}

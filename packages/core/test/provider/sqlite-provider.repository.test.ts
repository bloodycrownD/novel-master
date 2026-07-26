import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteProviderRepository } from "../../src/domain/provider/repositories/impl/sqlite-provider.repository.js";
import { ProviderError } from "../../src/errors/provider-errors.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

const EMPTY_DISPLAY_PROVIDER_ID = "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee";
const BLANK_DISPLAY_PROVIDER_ID = "bbbbbbbb-bbbb-4ccc-dddd-eeeeeeeeeeee";
const NOW_MS = 1_700_000_000_000;

/** 直接写入 llm_provider 行，用于模拟脏数据。 */
async function insertProviderRow(
  conn: ReturnType<typeof getNovelMasterTestContext>["conn"],
  id: string,
  displayName: string,
): Promise<void> {
  await conn.execute(
    `INSERT INTO llm_provider (
      id, builtin_key, protocol, base_url, display_name, secret_ref,
      headers_json, is_builtin, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      null,
      "openai",
      "https://example.com/v1",
      displayName,
      null,
      "{}",
      0,
      NOW_MS,
      NOW_MS,
    ],
  );
}

function expectEmptyDisplayNameError(error: unknown, providerId: string): boolean {
  return (
    error instanceof ProviderError &&
    error.code === "INVALID_ARGUMENT" &&
    error.message.includes("display_name 不得为空") &&
    error.providerId === providerId
  );
}

describe("SqliteProviderRepository", () => {
  it("C-1：空 display_name 行 findById 抛 INVALID_ARGUMENT，不得回退 UUID", async () => {
    const ctx = getNovelMasterTestContext();
    await insertProviderRow(ctx.conn, EMPTY_DISPLAY_PROVIDER_ID, "");
    const repo = new SqliteProviderRepository(ctx.conn);

    await assert.rejects(
      () => repo.findById(EMPTY_DISPLAY_PROVIDER_ID),
      (error) => expectEmptyDisplayNameError(error, EMPTY_DISPLAY_PROVIDER_ID),
    );
  });

  it("C-1：空白 display_name 行 findById 抛 INVALID_ARGUMENT", async () => {
    const ctx = getNovelMasterTestContext();
    await insertProviderRow(ctx.conn, BLANK_DISPLAY_PROVIDER_ID, "   ");
    const repo = new SqliteProviderRepository(ctx.conn);

    await assert.rejects(
      () => repo.findById(BLANK_DISPLAY_PROVIDER_ID),
      (error) => expectEmptyDisplayNameError(error, BLANK_DISPLAY_PROVIDER_ID),
    );
  });

  it("C-1：空 display_name 行 list 抛 INVALID_ARGUMENT，不得回退 UUID", async () => {
    const ctx = getNovelMasterTestContext();
    const badId = "cccccccc-bbbb-4ccc-dddd-eeeeeeeeeeee";
    await insertProviderRow(ctx.conn, badId, "");
    const repo = new SqliteProviderRepository(ctx.conn);

    await assert.rejects(
      () => repo.list(),
      (error) => {
        if (!(error instanceof ProviderError) || error.code !== "INVALID_ARGUMENT") {
          return false;
        }
        assert.match(error.message, /display_name 不得为空/);
        assert.match(error.providerId ?? "", /^[0-9a-f-]{36}$/i);
        assert.notEqual(error.message.trim(), error.providerId);
        return true;
      },
    );
  });
});

/**
 * T-CA7（D6）：desktop 草稿写回透传纯函数。
 *
 * 未编辑（composerText === 水化文本）→ payload 含原样 tokenRanges；
 * 已编辑 → payload 无 tokenRanges 字段；旧草稿（无 ranges）→ JSON 无自有键；
 * 非法条目由 serialize 过滤、不抛错。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseComposerDraftJson,
  serializeComposerDraftJson,
  type ComposerDraftTokenRange,
} from "@shared/logic/chat";
import {
  resolveComposerDraftPersistPayload,
  type HydratedComposerDraft,
} from "@/features/chat/composer-draft-passthrough";

const HYDRATED_TEXT = "$技能 尾追";

const RANGES: ComposerDraftTokenRange[] = [
  { start: 0, end: 3 },
  { start: 4, end: 6 },
];

function hydratedWithRanges(): HydratedComposerDraft {
  return { text: HYDRATED_TEXT, tokenRanges: RANGES };
}

function hasOwnTokenRanges(value: object): boolean {
  return Object.prototype.hasOwnProperty.call(value, "tokenRanges");
}

function serializePayload(
  payload: ReturnType<typeof resolveComposerDraftPersistPayload>,
): string {
  const json = serializeComposerDraftJson(payload);
  assert.notEqual(json, null, "非空正文不应被序列化成 null");
  return json as string;
}

describe("T-CA7: resolveComposerDraftPersistPayload（D6 desktop 写回）", () => {
  it("未编辑 → payload 原样携带 tokenRanges，写→读 roundtrip 字段相等", () => {
    const payload = resolveComposerDraftPersistPayload(
      hydratedWithRanges(),
      HYDRATED_TEXT,
    );

    assert.equal(payload.text, HYDRATED_TEXT);
    assert.deepEqual(payload.tokenRanges, RANGES);

    const parsed = parseComposerDraftJson(serializePayload(payload));
    assert.equal(parsed.text, HYDRATED_TEXT);
    assert.deepEqual(parsed.tokenRanges, RANGES);
  });

  it("已编辑 → payload 与 JSON 均无 tokenRanges 字段（交给 mobile 兜底扫描）", () => {
    const payload = resolveComposerDraftPersistPayload(
      hydratedWithRanges(),
      `${HYDRATED_TEXT}加字`,
    );

    assert.equal(hasOwnTokenRanges(payload), false);

    const json = serializePayload(payload);
    assert.equal(hasOwnTokenRanges(JSON.parse(json)), false);

    const parsed = parseComposerDraftJson(json);
    assert.equal(hasOwnTokenRanges(parsed), false);
    assert.equal(parsed.tokenRanges, undefined);
  });

  it("删除回水化文本之外的内容同样算编辑 → 不携带 ranges", () => {
    const hydrated: HydratedComposerDraft = {
      text: `${HYDRATED_TEXT}尾巴`,
      tokenRanges: RANGES,
    };
    const payload = resolveComposerDraftPersistPayload(
      hydrated,
      HYDRATED_TEXT,
    );

    assert.equal(hasOwnTokenRanges(payload), false);
  });

  it("旧草稿（水化无 ranges）→ JSON 无自有键，而非 []", () => {
    const payload = resolveComposerDraftPersistPayload(
      { text: HYDRATED_TEXT },
      HYDRATED_TEXT,
    );

    assert.equal(hasOwnTokenRanges(payload), false);

    const parsed = parseComposerDraftJson(serializePayload(payload));
    assert.equal(hasOwnTokenRanges(parsed), false);
    assert.deepEqual(parsed.attachments, []);
  });

  it("尚未水化（snapshot null）→ 不携带 ranges", () => {
    const payload = resolveComposerDraftPersistPayload(null, HYDRATED_TEXT);

    assert.equal(hasOwnTokenRanges(payload), false);
  });

  it("确认无胶囊（[]）→ 写回 [] 且读回 []，与 undefined 语义区分", () => {
    const payload = resolveComposerDraftPersistPayload(
      { text: "手输$foo", tokenRanges: [] },
      "手输$foo",
    );

    assert.deepEqual(payload.tokenRanges, []);

    const parsed = parseComposerDraftJson(serializePayload(payload));
    assert.equal(hasOwnTokenRanges(parsed), true);
    assert.deepEqual(parsed.tokenRanges, []);
  });

  it("非法条目 serialize 过滤：坏区间丢弃、合法区间照写、不抛错", () => {
    const dirty = [
      { start: 0, end: 3 },
      { start: 3, end: 3 },
      { start: -1, end: 2 },
      { start: 1.5, end: 4 },
      null,
    ] as unknown as ComposerDraftTokenRange[];

    const payload = resolveComposerDraftPersistPayload(
      { text: HYDRATED_TEXT, tokenRanges: dirty },
      HYDRATED_TEXT,
    );
    const parsed = parseComposerDraftJson(serializePayload(payload));

    assert.deepEqual(parsed.tokenRanges, [{ start: 0, end: 3 }]);
  });

  it("全部非法 → 写 []（不抛错），不影响正文", () => {
    const payload = resolveComposerDraftPersistPayload(
      {
        text: HYDRATED_TEXT,
        tokenRanges: [{ start: 2, end: 2 }] as unknown as ComposerDraftTokenRange[],
      },
      HYDRATED_TEXT,
    );
    const json = serializePayload(payload);
    const raw = JSON.parse(json) as { text: string; tokenRanges: unknown[] };

    assert.equal(raw.text, HYDRATED_TEXT);
    assert.deepEqual(raw.tokenRanges, []);
    assert.deepEqual(parseComposerDraftJson(json).tokenRanges, []);
  });
});

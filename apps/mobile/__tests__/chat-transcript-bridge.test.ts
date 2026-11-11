/**
 * P2-18i：桥层协议面不只剩 re-export。
 *
 * spec §9.1.1 要求这里覆盖 C1 新编解码/ready t2；旧编解码函数已随 C1 删除，
 * 剩下的协议真源是 `ChatTranscriptBridge.ts` 的两组 union。下面用
 * `Record<Union, true>` 做编译期穷尽 + 运行时键集合 + 声明源解析三层钉住
 * 「新增/删除 wire type 必须同步改清单」，避免协议集合只靠 tsc 守护。
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {
  CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
  type HostToTranscriptType,
  type TranscriptToHostType,
} from '@/components/chat/ChatTranscriptBridge';
import {CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION as SOURCE_SCHEMA_VERSION} from '@/services/chat-transcript-scroll-cache';

/** 编译期穷尽：union 增删 type 时这里必须同步（否则 tsc 报错）。 */
const HOST_TO_TRANSCRIPT_TYPES: Record<HostToTranscriptType, true> = {
  init: true,
  sessionSnapshot: true,
  prependPage: true,
  appendTailRows: true,
  streamDelta: true,
  streamBlockCommit: true,
  streamReset: true,
  streamStatus: true,
  themeUpdate: true,
  flagsUpdate: true,
  closeMenu: true,
  closeMermaidViewer: true,
};

const TRANSCRIPT_TO_HOST_TYPES: Record<TranscriptToHostType, true> = {
  ready: true,
  scrollSnapshot: true,
  loadOlder: true,
  openMessageMenu: true,
  openToolFile: true,
  linkClick: true,
  openSubagentSession: true,
  openSkillDetail: true,
  openToolResult: true,
  messageMenuAction: true,
  menuOpened: true,
  menuClosed: true,
  mermaidViewerOpened: true,
  mermaidViewerClosed: true,
  copyCode: true,
  streamResync: true,
  visibility: true,
};

/**
 * 从声明源解析 `BridgeEnvelope<'…'>` 的 type 字面量：union 是纯类型，
 * 运行时只能靠这里与上面的清单双向对账（改了源没改清单 → 红）。
 */
function declaredWireTypes(startMarker: string, endMarker: string): string[] {
  const source = readFileSync(
    join(__dirname, '../src/components/chat/ChatTranscriptBridge.ts'),
    'utf8',
  );
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(`wire type region not found: ${startMarker}`);
  }
  const region = source.slice(start, end);
  return [...region.matchAll(/BridgeEnvelope<\s*'([^']+)'/g)].map(
    match => match[1]!,
  );
}

const DECLARED_HOST_TYPES = declaredWireTypes(
  'export type HostToTranscriptMessage =',
  'export type TranscriptToHostMessage =',
);
const DECLARED_UPSTREAM_TYPES = declaredWireTypes(
  'export type TranscriptToHostMessage =',
  'export type HostToTranscriptType =',
);

describe('chat-transcript-bridge', () => {
  it('re-exports the scroll snapshot schema version from the cache module', () => {
    expect(CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION).toBe(SOURCE_SCHEMA_VERSION);
  });

  it('T-BR1: 下行 type 清单固定 12 条且与声明源一致', () => {
    expect(DECLARED_HOST_TYPES).toEqual([
      'init',
      'sessionSnapshot',
      'prependPage',
      'appendTailRows',
      'streamDelta',
      'streamBlockCommit',
      'streamReset',
      'streamStatus',
      'themeUpdate',
      'flagsUpdate',
      'closeMenu',
      'closeMermaidViewer',
    ]);
    expect(Object.keys(HOST_TO_TRANSCRIPT_TYPES).sort()).toEqual(
      [...DECLARED_HOST_TYPES].sort(),
    );
  });

  it('T-BR2: 上行 type 清单含 streamResync，共 17 条且与声明源一致', () => {
    expect(DECLARED_UPSTREAM_TYPES).toEqual([
      'ready',
      'scrollSnapshot',
      'loadOlder',
      'openMessageMenu',
      'openToolFile',
      'linkClick',
      'openSubagentSession',
      'openSkillDetail',
      'openToolResult',
      'messageMenuAction',
      'menuOpened',
      'menuClosed',
      'mermaidViewerOpened',
      'mermaidViewerClosed',
      'copyCode',
      'streamResync',
      'visibility',
    ]);
    expect(Object.keys(TRANSCRIPT_TO_HOST_TYPES).sort()).toEqual(
      [...DECLARED_UPSTREAM_TYPES].sort(),
    );
    expect(DECLARED_UPSTREAM_TYPES).toContain('streamResync');
  });
});

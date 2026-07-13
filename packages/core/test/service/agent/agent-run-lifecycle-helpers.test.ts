import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  shouldAcceptRunEvent,
  shouldApplyTranscriptReload,
  shouldIgnoreStaleRunStarted,
  shouldReloadTranscriptOnRunEvent,
} from '../../../src/service/agent/logic/agent-run-lifecycle-helpers.js';

describe('shouldAcceptRunEvent', () => {
  it('activeRunId 为空时拒绝', () => {
    assert.equal(shouldAcceptRunEvent(null, 'run-1'), false);
    assert.equal(shouldAcceptRunEvent(null, undefined), false);
  });

  it('runId 为空时拒绝', () => {
    assert.equal(shouldAcceptRunEvent('run-1', undefined), false);
    assert.equal(shouldAcceptRunEvent('run-1', ''), false);
  });

  it('runId 匹配时接受', () => {
    assert.equal(shouldAcceptRunEvent('run-a', 'run-a'), true);
  });

  it('stale runId 不匹配时拒绝', () => {
    assert.equal(shouldAcceptRunEvent('run-a', 'run-b'), false);
  });

  it('abort 后保留 activeRunId 时 RUN_FINISHED 仍可 accept', () => {
    assert.equal(shouldAcceptRunEvent('run-abort', 'run-abort'), true);
  });
});

describe('shouldIgnoreStaleRunStarted', () => {
  it('abort 后 uiRunning=false 时忽略 RUN_STARTED（保留 activeRunId 亦然）', () => {
    assert.equal(shouldIgnoreStaleRunStarted(false, null), true);
    assert.equal(shouldIgnoreStaleRunStarted(false, 'run-1'), true);
  });

  it('beginUiRun 窗口内 uiRunning=true 时接受 RUN_STARTED', () => {
    assert.equal(shouldIgnoreStaleRunStarted(true, null), false);
    assert.equal(shouldIgnoreStaleRunStarted(true, 'run-1'), false);
  });
});

describe('shouldReloadTranscriptOnRunEvent', () => {
  it('T-AC2-1: uiRunning=false 时禁止 reload；true 时允许', () => {
    assert.equal(shouldReloadTranscriptOnRunEvent(false), false);
    assert.equal(shouldReloadTranscriptOnRunEvent(true), true);
  });
});

describe('shouldApplyTranscriptReload', () => {
  it('uiRunning=false 且无 retain 例外时禁止 reload', () => {
    assert.equal(shouldApplyTranscriptReload(false, null), false);
  });

  it('uiRunning=true 且无 freeze 时允许 reload', () => {
    assert.equal(shouldApplyTranscriptReload(true, null), true);
  });

  it('freezeCount 非 null 时禁止一切增列表 reload', () => {
    assert.equal(shouldApplyTranscriptReload(true, 3), false);
    assert.equal(shouldApplyTranscriptReload(false, 3), false);
  });

  it('T-ARP-L2: abort retain + assistant phase 允许一次 reload（不受 freeze 约束）', () => {
    assert.equal(
      shouldApplyTranscriptReload(false, 2, {
        abortRetainPending: true,
        phase: 'assistant',
      }),
      true,
    );
  });

  it('T-ARP-L3: abort retain + tool_results phase 仍禁止 reload', () => {
    assert.equal(
      shouldApplyTranscriptReload(false, 2, {
        abortRetainPending: true,
        phase: 'tool_results',
      }),
      false,
    );
  });
});

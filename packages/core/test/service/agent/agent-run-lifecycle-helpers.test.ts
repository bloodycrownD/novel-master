import assert from 'node:assert/strict';
import {  describe, it  } from 'node:test';
import {  RunLifecycle  } from '../../../src/service/agent/logic/agent-run-lifecycle-helpers.js';

describe('RunLifecycle.shouldAccept', () => {
  it('activeRunId 为空时拒绝', () => {
    assert.equal(RunLifecycle.shouldAccept(null, 'run-1'), false);
    assert.equal(RunLifecycle.shouldAccept(null, undefined), false);
  });

  it('runId 为空时拒绝', () => {
    assert.equal(RunLifecycle.shouldAccept('run-1', undefined), false);
    assert.equal(RunLifecycle.shouldAccept('run-1', ''), false);
  });

  it('runId 匹配时接受', () => {
    assert.equal(RunLifecycle.shouldAccept('run-a', 'run-a'), true);
  });

  it('stale runId 不匹配时拒绝', () => {
    assert.equal(RunLifecycle.shouldAccept('run-a', 'run-b'), false);
  });

  it('abort 后保留 activeRunId 时 RUN_FINISHED 仍可 accept', () => {
    assert.equal(RunLifecycle.shouldAccept('run-abort', 'run-abort'), true);
  });
});

describe('RunLifecycle.shouldIgnoreStale', () => {
  it('abort 后 uiRunning=false 时忽略 RUN_STARTED（保留 activeRunId 亦然）', () => {
    assert.equal(RunLifecycle.shouldIgnoreStale(false, null), true);
    assert.equal(RunLifecycle.shouldIgnoreStale(false, 'run-1'), true);
  });

  it('beginUiRun 窗口内 uiRunning=true 时接受 RUN_STARTED', () => {
    assert.equal(RunLifecycle.shouldIgnoreStale(true, null), false);
    assert.equal(RunLifecycle.shouldIgnoreStale(true, 'run-1'), false);
  });
});

describe('RunLifecycle.shouldReload', () => {
  it('T-AC2-1: uiRunning=false 时禁止 reload；true 时允许', () => {
    assert.equal(RunLifecycle.shouldReload(false), false);
    assert.equal(RunLifecycle.shouldReload(true), true);
  });
});

describe('RunLifecycle.shouldApply', () => {
  it('uiRunning=false 且无 retain 例外时禁止 reload', () => {
    assert.equal(RunLifecycle.shouldApply(false, null), false);
  });

  it('uiRunning=true 且无 freeze 时允许 reload', () => {
    assert.equal(RunLifecycle.shouldApply(true, null), true);
  });

  it('freezeCount 非 null 时禁止一切增列表 reload', () => {
    assert.equal(RunLifecycle.shouldApply(true, 3), false);
    assert.equal(RunLifecycle.shouldApply(false, 3), false);
  });

  it('T-ARP-L2: abort retain + assistant phase 允许一次 reload（不受 freeze 约束）', () => {
    assert.equal(
      RunLifecycle.shouldApply(false, 2, {
        abortRetainPending: true,
        phase: 'assistant',
      }),
      true,
    );
  });

  it('T-ARP-L3: abort retain + tool_results phase 仍禁止 reload', () => {
    assert.equal(
      RunLifecycle.shouldApply(false, 2, {
        abortRetainPending: true,
        phase: 'tool_results',
      }),
      false,
    );
  });
});

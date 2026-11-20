import {describe, expect, it} from '@jest/globals';
import {FileAnnotateGate} from '@/components/vfs/file-annotate-gate'

describe('shouldEnableFileAnnotate (P1-D2 / T-MAN1 gate)', () => {
  it('仅 previewMode + scopeKind=session + sessionId 为真', () => {
    expect(
      FileAnnotateGate.shouldEnable({
        previewMode: true,
        scopeKind: 'session',
        sessionId: 's1',
      }),
    ).toBe(true);
  });

  it('编辑态无入口', () => {
    expect(
      FileAnnotateGate.shouldEnable({
        previewMode: false,
        scopeKind: 'session',
        sessionId: 's1',
      }),
    ).toBe(false);
  });

  it('project / global 无入口', () => {
    expect(
      FileAnnotateGate.shouldEnable({
        previewMode: true,
        scopeKind: 'project',
        sessionId: 's1',
      }),
    ).toBe(false);
    expect(
      FileAnnotateGate.shouldEnable({
        previewMode: true,
        scopeKind: 'global',
        sessionId: 's1',
      }),
    ).toBe(false);
  });

  it('缺 sessionId 无入口', () => {
    expect(
      FileAnnotateGate.shouldEnable({
        previewMode: true,
        scopeKind: 'session',
      }),
    ).toBe(false);
    expect(
      FileAnnotateGate.shouldEnable({
        previewMode: true,
        scopeKind: 'session',
        sessionId: '',
      }),
    ).toBe(false);
  });
});

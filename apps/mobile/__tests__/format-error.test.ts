import {TdbcError} from '@novel-master/core';
import {AppError} from '@novel-master/core/agent';
import {formatError, formatVfsError} from '@/errors/format-error';

describe('formatError (T4)', () => {
  it('formats VfsError message', () => {
    const err = new AppError('VFS_NOT_FOUND', {path: '/x', detail: 'Path not found: /x'});
    expect(formatError(err)).toBe('文件不存在或已被删除。');
  });

  it('formats AppError message (align VfsZipError)', () => {
    const zipErr = new AppError('VFS_ZIP_INVALID_ARCHIVE', {detail: 'bad zip'});
    // 迁移后 VFS_ZIP_* 统一走 `error.vfs.operation_failed` 兜底，不再是裸 message 透传。
    expect(formatError(zipErr)).toBe('操作失败：bad zip');
    const cardErr = new AppError(
      'VFS_CHARACTER_CARD_UNRECOGNIZED',
      '无法识别为角色卡',
    );
    // messageKey 通道优先于 operation_failed 兜底：该 key 在 catalog 的模板
    // 本身无占位符，直接渲染模板原文。
    expect(formatError(cardErr)).toBe('无法识别为角色卡');
  });

  it('T-M-TOAST-01: REPLACE_NOT_FOUND uses Chinese refresh hint', () => {
    const err = new AppError('VFS_REPLACE_NOT_FOUND', {
      path: '/x',
      oldStringLength: 10,
      longestCommonSubstring: 'foo',
      lcsLength: 3,
      lcsOccurrences: 1,
      detail: 'Replace string not found in /x',
    });
    expect(formatError(err)).toContain('刷新');
  });

  it('T-M-TOAST-02: NOT_FOUND 返回中文不存在提示（CONFLICT 已随版本校验下线）', () => {
    const err = new AppError('VFS_NOT_FOUND', {path: '/x', detail: 'Path not found: /x'});
    expect(formatError(err)).toContain('不存在');
  });

  it('formats ProviderError API_KEY_NOT_SET for mobile', () => {
    const err = new AppError('PROVIDER_API_KEY_NOT_SET', {detail: 'API key not set'});
    expect(formatError(err)).toBe('请先在服务商设置中配置 API Key');
  });

  it('formats CHAT_NOT_FOUND message', () => {
    // messageKey 通道：params 走 ErrorParamsMap 字段（kind/id），模板按
    // snake_case 占位符插值。
    const err = new AppError('CHAT_NOT_FOUND', {kind: 'session', id: 's1'});
    expect(formatError(err)).toBe('会话数据不存在：session s1');
  });

  it('formats ToolError with cause', () => {
    const err = new AppError('TOOL_FAILED', {
      toolName: 'read',
      cause: new Error('Path missing'),
      detail: 'Tool failed: vfs.read',
    });
    expect(formatError(err)).toBe('Tool failed: vfs.read\nPath missing');
  });

  it('formats AppError message', () => {
    const err = new AppError('AGENT_DOOM_LOOP', 'Doom loop detected');
    expect(formatError(err)).toBe('操作失败：Doom loop detected');
  });

  it('formats TdbcError with cause', () => {
    const err = new TdbcError('SQLITE_ERROR', 'Failed to open database', {
      cause: new Error('JSI not available'),
    });
    expect(formatError(err)).toBe('Failed to open database\nJSI not available');
  });

  it('formats generic Error', () => {
    expect(formatError(new Error('boom'))).toBe('boom');
  });

  it('formats non-Error values', () => {
    expect(formatError(42)).toBe('42');
  });
});

/**
 * `formatVfsError` 的兼容层断言（CR L1-7 / dead P2-2）。
 *
 * 背景：Wave D 删 `src/vfs/errors.ts` 这层 shim 时把它唯一的测试
 * `__tests__/errors.test.ts` 一并删掉，`formatVfsError` 本体却留在
 * `format-error.ts` 里成了零消费孤儿，还挂着「kept for VFS call sites」
 * 这条已经不成立的注释。这 5 条测的是**纯函数行为**（不是那层 4 行
 * shim），所以整段恢复、import 改指 `@/errors/format-error`，一条断言不丢。
 */
describe('formatVfsError (兼容层)', () => {
  it('formats VfsError message', () => {
    const err = new AppError('VFS_NOT_FOUND', {path: '/x', detail: 'Path not found: /x'});
    // 用户可见层按 key/code 映射中文（走 core 的 formatVfsErrorForUser）
    expect(formatVfsError(err)).toBe('文件不存在或已被删除。');
  });

  it('formats TdbcError message', () => {
    const err = new TdbcError('INVALID_URL', 'Expected tdbc:sqlite:<path>');
    expect(formatVfsError(err)).toBe('Expected tdbc:sqlite:<path>');
  });

  it('formats TdbcError with cause', () => {
    const err = new TdbcError('SQLITE_ERROR', 'Failed to open database', {
      cause: new Error('JSI not available'),
    });
    expect(formatVfsError(err)).toBe(
      'Failed to open database\nJSI not available',
    );
  });

  it('formats generic Error', () => {
    expect(formatVfsError(new Error('boom'))).toBe('boom');
  });

  it('formats non-Error values', () => {
    expect(formatVfsError(42)).toBe('42');
  });
});

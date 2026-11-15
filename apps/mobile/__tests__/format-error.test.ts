import {TdbcError} from '@novel-master/core';
import {AppError} from '@novel-master/core/agent';
import {formatError} from '@/errors/format-error';

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

  it('formats ProviderError API_KEY_NOT_SET for mobile（文案进 catalog，messageKey 通道）', () => {
    const err = new AppError('PROVIDER_API_KEY_NOT_SET', {detail: 'API key not set'});
    expect(formatError(err)).toBe('请先在服务商设置中配置 API Key');
  });

  it('formats PROVIDER_MODEL_NOT_SAVED（文案进 catalog，messageKey 通道）', () => {
    const err = new AppError('PROVIDER_MODEL_NOT_SAVED');
    expect(formatError(err)).toBe('请先从远程拉取并保存模型');
  });

  it('formats CHAT_NOT_FOUND message', () => {
    // messageKey 通道：params 走 ErrorParamsMap 字段（kind/id），模板按
    // snake_case 占位符插值。
    const err = new AppError('CHAT_NOT_FOUND', {kind: 'session', id: 's1'});
    expect(formatError(err)).toBe('会话数据不存在：session s1');
  });

  it('formats TOOL_FAILED with non-VFS cause（messageKey 模板渲染，cause 不再拼接）', () => {
    const err = new AppError('TOOL_FAILED', {
      toolName: 'read',
      cause: new Error('Path missing'),
      detail: 'Tool failed: vfs.read',
    });
    expect(formatError(err)).toBe('工具执行失败：read');
  });

  it('formats AppError without messageKey（通配分支回退原 message，不落 VFS 文案表）', () => {
    const err = new AppError('AGENT_DOOM_LOOP', {detail: 'Doom loop detected'});
    expect(formatError(err)).toBe('Doom loop detected');
  });

  it('formats TdbcError with cause', () => {
    const err = new TdbcError('SQLITE_ERROR', 'Failed to open database', {
      cause: new Error('JSI not available'),
    });
    expect(formatError(err)).toBe('Failed to open database\nJSI not available');
  });

  it('formats TdbcError without cause（无内因时只出 message）', () => {
    const err = new TdbcError('INVALID_URL', 'Expected tdbc:sqlite:<path>');
    expect(formatError(err)).toBe('Expected tdbc:sqlite:<path>');
  });

  it('formats generic Error', () => {
    expect(formatError(new Error('boom'))).toBe('boom');
  });

  it('formats non-Error values', () => {
    expect(formatError(42)).toBe('42');
  });
});


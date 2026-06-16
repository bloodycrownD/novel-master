import { TdbcError, ToolError } from "@novel-master/core";
import { AgentError } from "@novel-master/core/agent";
import { ChatError } from "@novel-master/core/chat";
import { ProviderError } from "@novel-master/core/provider";
import { VfsError } from "@novel-master/core/vfs";
import {formatError} from '../src/errors/format-error';

describe('formatError (T4)', () => {
  it('formats VfsError message', () => {
    const err = new VfsError('NOT_FOUND', 'Path not found: /x', {path: '/x'});
    expect(formatError(err)).toBe('Path not found: /x');
  });

  it('formats ProviderError message', () => {
    const err = new ProviderError('API_KEY_NOT_SET', 'API key not set', {
      providerId: 'openai',
    });
    expect(formatError(err)).toBe('API key not set');
  });

  it('formats ChatError message', () => {
    const err = new ChatError('NOT_FOUND', 'session not found: s1', {
      sessionId: 's1',
    });
    expect(formatError(err)).toBe('session not found: s1');
  });

  it('formats ToolError with cause', () => {
    const err = new ToolError('FAILED', 'Tool failed: vfs.read', {
      toolName: 'read',
      cause: new Error('Path missing'),
    });
    expect(formatError(err)).toBe('Tool failed: vfs.read\nPath missing');
  });

  it('formats AgentError message', () => {
    const err = new AgentError('DOOM_LOOP', 'Doom loop detected');
    expect(formatError(err)).toBe('Doom loop detected');
  });

  it('formats TdbcError with cause', () => {
    const err = new TdbcError('SQLITE_ERROR', 'Failed to open database', {
      cause: new Error('JSI not available'),
    });
    expect(formatError(err)).toBe(
      'Failed to open database\nJSI not available',
    );
  });

  it('formats generic Error', () => {
    expect(formatError(new Error('boom'))).toBe('boom');
  });

  it('formats non-Error values', () => {
    expect(formatError(42)).toBe('42');
  });
});

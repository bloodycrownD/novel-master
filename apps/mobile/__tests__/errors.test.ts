import { TdbcError } from "@novel-master/core";
import { VfsError } from "@novel-master/core/vfs";
import {formatVfsError} from '../src/vfs/errors';

describe('formatVfsError', () => {
  it('formats VfsError message', () => {
    const err = new VfsError('NOT_FOUND', 'Path not found: /x', {path: '/x'});
    expect(formatVfsError(err)).toBe('Path not found: /x');
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

import {formatError} from './format-error';

/** Single-line toast copy from a title and optional detail or error value. */
export function toastMessage(title: string, detail?: unknown): string {
  if (detail === undefined || detail === null || detail === '') {
    return title;
  }
  const text = typeof detail === 'string' ? detail : formatError(detail);
  const trimmed = text.trim();
  return trimmed ? `${title}：${trimmed}` : title;
}

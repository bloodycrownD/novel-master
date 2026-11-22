import {FormatError} from './format-error';

export namespace ToastMessage {
    /** Single-line toast copy from a title and optional detail or error value. */
    export function toast(title: string, detail?: unknown): string {
        if (detail === undefined || detail === null || detail === '') {
            return title;
        }
        const text = typeof detail === 'string' ? detail : FormatError.format(detail);
        const trimmed = text.trim();
        return trimmed ? `${title}：${trimmed}` : title;
    }
}

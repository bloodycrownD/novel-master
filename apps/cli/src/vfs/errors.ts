import { TdbcError, VfsError } from "@novel-master/core";

export const EXIT_USAGE = 1;
export const EXIT_RUNTIME = 2;

export function formatCliError(error: unknown): string {
  if (error instanceof VfsError) {
    return error.message;
  }
  if (error instanceof TdbcError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function exitCodeForError(error: unknown): number {
  if (error instanceof VfsError || error instanceof TdbcError) {
    return EXIT_RUNTIME;
  }
  if (error instanceof Error && error.message.startsWith("Usage:")) {
    return EXIT_USAGE;
  }
  return EXIT_RUNTIME;
}

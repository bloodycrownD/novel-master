/**
 * CLI error formatting and exit codes.
 *
 * @module cli-errors
 */

import {
  AgentError,
  ChatError,
  CompactionPolicyError,
  PreferencesError,
  PromptError,
  ProviderError,
  TdbcError,
  VfsError,
} from "@novel-master/core";
import { SkspError } from "@novel-master/core/sksp";

export const EXIT_USAGE = 1;
export const EXIT_RUNTIME = 2;

export function formatCliError(error: unknown): string {
  if (error instanceof AgentError) {
    return error.message;
  }
  if (
    error instanceof VfsError ||
    error instanceof PreferencesError ||
    error instanceof CompactionPolicyError ||
    error instanceof ChatError ||
    error instanceof PromptError ||
    error instanceof TdbcError ||
    error instanceof ProviderError ||
    error instanceof SkspError
  ) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function exitCodeForError(error: unknown): number {
  if (error instanceof AgentError) {
    return EXIT_RUNTIME;
  }
  if (
    error instanceof VfsError ||
    error instanceof PreferencesError ||
    error instanceof CompactionPolicyError ||
    error instanceof ChatError ||
    error instanceof PromptError ||
    error instanceof TdbcError ||
    error instanceof ProviderError ||
    error instanceof SkspError
  ) {
    return EXIT_RUNTIME;
  }
  if (error instanceof Error && error.message.startsWith("Usage:")) {
    return EXIT_USAGE;
  }
  return EXIT_RUNTIME;
}

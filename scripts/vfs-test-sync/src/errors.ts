/**
 * Configuration and usage errors for vfs-test-sync.
 */

/** Thrown when CLI arguments or environment are invalid. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Thrown when VFS ↔ mirror path mapping is invalid. */
export class PathMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathMapError";
  }
}

/** Thrown when mirror directory IO fails. */
export class MirrorError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MirrorError";
  }
}

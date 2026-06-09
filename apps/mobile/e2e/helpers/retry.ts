/** Retry flaky WebView / Appium interactions with short backoff. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    attempts?: number;
    delayMs?: number;
    label?: string;
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 600;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await browser.pause(delayMs);
      }
    }
  }

  const label = options.label ?? 'operation';
  throw new Error(
    `[e2e] ${label} failed after ${attempts} attempts: ${String(lastError)}`,
  );
}

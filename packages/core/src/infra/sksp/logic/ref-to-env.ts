/**
 * Maps SKSP refs to environment variable names.
 *
 * @module infra/sksp/logic/ref-to-env
 */

/**
 * SKSP ref → 环境变量名映射。
 */
export const SkspRefToEnv = {
    /**
   * `provider/<id>/apiKey` →`NOVEL_MASTER_PROVIDER_<ID>_API_KEY`.
   * Returns `null` when ref is not a provider apiKey ref.
   */
    toEnvVar(ref: string): string | null {
        const m = /^provider\/([^/]+)\/apiKey$/.exec(ref);
        if (!m) {
            return null;
        }
        const id = m[1]!.toUpperCase().replace(/[^A-Z0-9]/g, "_");
        return `NOVEL_MASTER_PROVIDER_${id}_API_KEY`;
    },
} as const;

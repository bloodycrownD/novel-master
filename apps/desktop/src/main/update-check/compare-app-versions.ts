/**
 * Semver comparison for app versions (major.minor.patch numeric parts only).
 * Returns -1 when local is older, 0 when equal, 1 when local is newer.
 */

function parseParts(version: string): [number, number, number] {
  const parts = version.split(".");
  if (parts.length !== 3) {
    throw new Error(`无效的版本号: ${version}`);
  }
  const nums = parts.map((p) => {
    const n = Number.parseInt(p, 10);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`无效的版本号: ${version}`);
    }
    return n;
  });
  return [nums[0]!, nums[1]!, nums[2]!];
}

export function compareAppVersions(local: string, remote: string): -1 | 0 | 1 {
  const [lMajor, lMinor, lPatch] = parseParts(local);
  const [rMajor, rMinor, rPatch] = parseParts(remote);
  if (lMajor !== rMajor) {
    return lMajor < rMajor ? -1 : 1;
  }
  if (lMinor !== rMinor) {
    return lMinor < rMinor ? -1 : 1;
  }
  if (lPatch !== rPatch) {
    return lPatch < rPatch ? -1 : 1;
  }
  return 0;
}

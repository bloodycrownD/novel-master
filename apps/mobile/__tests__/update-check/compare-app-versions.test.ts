import {Release} from '@novel-master/core/common';

describe('compareAppVersions', () => {
  it('returns -1 when local is older', () => {
    const cmp = Release.compareVersions('0.1.0', '0.2.0');
    expect(cmp.ok).toBe(true);
    if (cmp.ok) {
      expect(cmp.value).toBe(-1);
    }
  });

  it('returns 0 when equal', () => {
    const cmp = Release.compareVersions('0.2.0', '0.2.0');
    expect(cmp.ok).toBe(true);
    if (cmp.ok) {
      expect(cmp.value).toBe(0);
    }
  });

  it('returns 1 when local is newer', () => {
    const cmp = Release.compareVersions('0.3.0', '0.2.9');
    expect(cmp.ok).toBe(true);
    if (cmp.ok) {
      expect(cmp.value).toBe(1);
    }
  });
});

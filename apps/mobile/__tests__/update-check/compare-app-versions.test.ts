import {compareAppVersions} from '../../src/update-check/compare-app-versions';

describe('compareAppVersions', () => {
  it('returns -1 when local is older', () => {
    expect(compareAppVersions('0.1.0', '0.2.0')).toBe(-1);
  });

  it('returns 0 when equal', () => {
    expect(compareAppVersions('0.2.0', '0.2.0')).toBe(0);
  });

  it('returns 1 when local is newer', () => {
    expect(compareAppVersions('0.3.0', '0.2.9')).toBe(1);
  });
});

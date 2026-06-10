import {parseReleaseTag} from '../../src/update-check/parse-release-tag';

describe('parseReleaseTag', () => {
  it('parses v1.2.3', () => {
    expect(parseReleaseTag('v1.2.3')).toBe('1.2.3');
  });

  it('throws on invalid tag', () => {
    expect(() => parseReleaseTag('latest')).toThrow(/无法解析版本标签/);
  });
});

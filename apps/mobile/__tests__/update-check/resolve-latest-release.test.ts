import {resolveLatestRelease} from '../../src/update-check/resolve-latest-release';

describe('resolveLatestRelease', () => {
  it('maps latest JSON fixture', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v2.1.0',
        html_url:
          'https://github.com/bloodycrownD/novel-master/releases/tag/v2.1.0',
        body: 'Release notes',
      }),
    });

    const release = await resolveLatestRelease(mockFetch as typeof fetch);
    expect(release.tagName).toBe('v2.1.0');
    expect(release.version).toBe('2.1.0');
    expect(release.htmlUrl).toContain('releases/tag/v2.1.0');
  });
});

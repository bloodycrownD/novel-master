import {checkForUpdates} from '../../src/update-check/check-for-updates';

describe('checkForUpdates', () => {
  it('reports update-available when local is older', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v9.9.9',
        html_url: 'https://github.com/bloodycrownD/novel-master/releases/tag/v9.9.9',
        body: 'Notes',
      }),
    });

    const result = await checkForUpdates('0.0.1', mockFetch as typeof fetch);
    expect(result.status).toBe('update-available');
    expect(result.remoteVersion).toBe('9.9.9');
  });
});

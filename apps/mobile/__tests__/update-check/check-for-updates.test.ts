import {checkForUpdates} from '@/update-check/check-for-updates';

describe('checkForUpdates', () => {
  it('reports update-available when local is older', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v9.9.9',
        html_url:
          'https://github.com/bloodycrownD/novel-master/releases/tag/v9.9.9',
        body: 'Notes',
      }),
    });

    const checked = await checkForUpdates('0.0.1', mockFetch as typeof fetch);
    expect(checked.ok).toBe(true);
    if (!checked.ok) {
      throw new Error('合法版本号比较不应失败');
    }
    expect(checked.value.status).toBe('update-available');
    expect(checked.value.remoteVersion).toBe('9.9.9');
  });
});

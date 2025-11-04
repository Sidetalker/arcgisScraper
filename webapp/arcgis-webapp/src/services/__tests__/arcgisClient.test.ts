import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearArcgisCaches, fetchListings } from '@/services/arcgisClient';

interface MockResponseBody {
  ok?: boolean;
  status?: number;
  json: () => Promise<Record<string, unknown>>;
  text: () => Promise<string>;
}

describe('fetchListings', () => {
  const fetchMock = vi.fn<[
    RequestInfo | URL,
    RequestInit | undefined
  ], Promise<MockResponseBody>>();

  beforeEach(() => {
    fetchMock.mockReset();

    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ maxRecordCount: 1000 }),
      text: async () => '',
    }));

    fetchMock.mockImplementationOnce(async (input, init) => ({
      ok: true,
      status: 200,
      json: async () => ({
        features: [
          {
            attributes: { OBJECTID: 1 },
          },
        ],
      }),
      text: async () => '',
    }));

    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    clearArcgisCaches();
    vi.unstubAllGlobals();
  });

  it('omits spatialRel when no geometry is provided', async () => {
    const result = await fetchListings({ useCache: false });

    expect(result.features?.length).toBe(1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondCall] = fetchMock.mock.calls;
    const requestInit = secondCall?.[1];
    const body = typeof requestInit?.body === 'string' ? requestInit.body : '';
    expect(body).not.toContain('spatialRel');
  });
});

import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CloudApiError,
  DEFAULT_CLOUD_URL,
  credentialsPath,
  fetchHealRequests,
  healSlug,
  readCloudCredentials,
  updateHealRequest,
  writeCloudCredentials,
} from '../src/cloud.js';

const tmpHomes: string[] = [];
function tmpHome(): string {
  const h = mkdtempSync(join(tmpdir(), 'hover-cloud-'));
  tmpHomes.push(h);
  return h;
}
afterEach(() => {
  while (tmpHomes.length) rmSync(tmpHomes.pop()!, { recursive: true, force: true });
});

describe('credentials chain', () => {
  it('prefers HOVER_CLOUD_TOKEN env over the file', () => {
    const home = tmpHome();
    writeCloudCredentials({ token: 'hover_pat_file' }, home);
    const creds = readCloudCredentials({ HOVER_CLOUD_TOKEN: 'hover_pat_env' }, home);
    expect(creds).toEqual({ token: 'hover_pat_env', url: DEFAULT_CLOUD_URL });
  });

  it('falls back to ~/.hover/credentials.json and defaults the url', () => {
    const home = tmpHome();
    writeCloudCredentials({ token: 'hover_pat_file' }, home);
    expect(readCloudCredentials({}, home)).toEqual({
      token: 'hover_pat_file',
      url: DEFAULT_CLOUD_URL,
    });
  });

  it('returns null when neither source exists', () => {
    expect(readCloudCredentials({}, tmpHome())).toBeNull();
  });

  it('writes 0600 and round-trips a custom url', () => {
    const home = tmpHome();
    const p = writeCloudCredentials({ token: 't', url: 'https://cloud.example.com' }, home);
    expect(p).toBe(credentialsPath(home));
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual({
      url: 'https://cloud.example.com',
      token: 't',
    });
  });
});

describe('cloud api client', () => {
  const creds = { token: 'hover_pat_x', url: 'https://cloud.example.com' };

  it('fetches the open queue with auth + query params', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ healRequests: [{ id: 'h1', specFile: 'a.spec.ts' }] }), {
        status: 200,
      }),
    );
    const rows = await fetchHealRequests(creds, { status: 'open', repo: 'o/r' }, fetchImpl);
    expect(rows).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://cloud.example.com/api/v1/heal-requests?status=open&repo=o%2Fr');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer hover_pat_x');
  });

  it('PATCHes a status transition', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await updateHealRequest(creds, 'h1', 'routed', fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://cloud.example.com/api/v1/heal-requests/h1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ status: 'routed' });
  });

  it('throws CloudApiError with the status on a non-2xx', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('{"error":"invalid token"}', { status: 401 }));
    await expect(fetchHealRequests(creds, {}, fetchImpl)).rejects.toMatchObject({
      status: 401,
    } satisfies Partial<CloudApiError>);
  });
});

describe('healSlug', () => {
  it('strips the path and .spec.ts', () => {
    expect(healSlug('__vibe_tests__/checkout.spec.ts')).toBe('checkout');
    expect(healSlug('log-in.spec.ts')).toBe('log-in');
  });
});

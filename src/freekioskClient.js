// -----------------------------------------------------------------------------
// HTTP client of ONE tablet's FreeKiosk REST API.
//
// A target is `{ host, port, apiKey }`. The API key, when FreeKiosk has one,
// travels in the `X-Api-Key` header (never in the URL, so it stays out of the
// logs). Every answer is JSON `{ success, data | error }`, except the camera
// photo (JPEG).
// -----------------------------------------------------------------------------

import { API, PHOTO_TIMEOUT_MS, REQUEST_TIMEOUT_MS, SCAN_TIMEOUT_MS } from './constants.js';

export class FreeKioskError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'FreeKioskError';
    this.status = status;
    this.code = code;
  }
}

export function baseUrl({ host, port }) {
  // An IPv6 literal needs brackets in a URL.
  const hostname = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `http://${hostname}:${port}`;
}

function headersFor(target, extra = {}) {
  const headers = { Accept: 'application/json', ...extra };
  if (target.apiKey) {
    headers['X-Api-Key'] = target.apiKey;
  }
  return headers;
}

async function fetchWithTimeout(url, options, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new FreeKioskError(`no answer within ${timeoutMs / 1000} s`, { code: 'TIMEOUT' });
    }
    throw new FreeKioskError(err.cause?.code ?? err.message, { code: 'UNREACHABLE' });
  } finally {
    clearTimeout(timer);
  }
}

function errorFromResponse(response, body) {
  const reason = body?.error ?? `HTTP ${response.status}`;
  if (response.status === 401) {
    return new FreeKioskError(`invalid or missing API key (${reason})`, {
      status: 401,
      code: 'UNAUTHORIZED',
    });
  }
  if (response.status === 403) {
    return new FreeKioskError(
      `remote control is disabled on the tablet (${reason}): enable "Allow remote control" in FreeKiosk`,
      { status: 403, code: 'FORBIDDEN' },
    );
  }
  return new FreeKioskError(reason, { status: response.status, code: 'HTTP_ERROR' });
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Create a client. `fetchImpl` is injectable for the tests (they never touch
 * the network).
 */
export function createFreeKioskClient({ fetchImpl = globalThis.fetch } = {}) {
  /**
   * Call one endpoint and resolve its `data`. A body turns the call into a
   * POST with a JSON payload; the commands without parameters are POSTed with
   * an empty object, which FreeKiosk accepts on every GET|POST endpoint.
   */
  async function request(target, path, { body, method, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    const verb = method ?? (body === undefined ? 'GET' : 'POST');
    const options = { method: verb, headers: headersFor(target) };
    if (verb === 'POST') {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body ?? {});
    }
    const response = await fetchWithTimeout(
      `${baseUrl(target)}${path}`,
      options,
      timeoutMs,
      fetchImpl,
    );
    const json = await readJson(response);
    if (!response.ok || json?.success === false) {
      throw errorFromResponse(response, json);
    }
    return json?.data ?? {};
  }

  return {
    request,

    /** Send a command (POST). */
    command(target, path, body) {
      return request(target, path, { method: 'POST', body });
    },

    /** Full status of the tablet (`GET /api/status`). */
    getStatus(target) {
      return request(target, API.STATUS);
    },

    /**
     * Tell whether a FreeKiosk REST server answers at this address, without
     * needing its API key: the root answers `{ data: { name: "FreeKiosk REST
     * API" } }`, or a 401 whose `WWW-Authenticate` realm (or error message)
     * names FreeKiosk when a key is set. Resolves `null` for anything else
     * (nothing listening, another web server).
     * @returns {Promise<{ authRequired: boolean } | null>}
     */
    async probe({ host, port }, { timeoutMs = SCAN_TIMEOUT_MS } = {}) {
      let response;
      try {
        response = await fetchWithTimeout(
          `${baseUrl({ host, port })}${API.ROOT}`,
          { method: 'GET', headers: { Accept: 'application/json' } },
          timeoutMs,
          fetchImpl,
        );
      } catch {
        return null;
      }
      const json = await readJson(response).catch(() => undefined);
      if (response.status === 401) {
        const realm = response.headers.get('www-authenticate') ?? '';
        const looksLikeFreeKiosk =
          /freekiosk/i.test(realm) || /missing API key/i.test(json?.error ?? '');
        return looksLikeFreeKiosk ? { authRequired: true } : null;
      }
      if (response.ok && /freekiosk/i.test(json?.data?.name ?? '')) {
        return { authRequired: false };
      }
      return null;
    },

    /**
     * Take a photo with one of the tablet's cameras and resolve the JPEG bytes.
     */
    async getPhoto(target, { camera, quality }) {
      const url = new URL(`${baseUrl(target)}${API.CAMERA_PHOTO}`);
      url.searchParams.set('camera', camera);
      url.searchParams.set('quality', String(quality));
      const response = await fetchWithTimeout(
        url,
        { method: 'GET', headers: headersFor(target, { Accept: 'image/jpeg' }) },
        PHOTO_TIMEOUT_MS,
        fetchImpl,
      );
      if (!response.ok) {
        throw errorFromResponse(response, await readJson(response));
      }
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

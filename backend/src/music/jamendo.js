import { setTimeout as sleep } from 'node:timers/promises';
import { HttpProblem } from '../errors.js';

const BASE_URL = 'https://api.jamendo.com/v3.0';

export function toTrack(t) {
  return {
    provider: 'jamendo',
    providerTrackId: String(t.id),
    title: t.name,
    artist: t.artist_name,
    durationMs: t.duration * 1000,
    coverUrl: t.album_image || t.image || null,
  };
}

export class JamendoClient {
  #clientId;
  #fetch;
  #timeoutMs;
  #log;

  constructor({ clientId, fetch = globalThis.fetch, timeoutMs = 5000, log } = {}) {
    this.#clientId = clientId;
    this.#fetch = fetch;
    this.#timeoutMs = timeoutMs;
    this.#log = log;
  }

  async search(q, { limit = 20 } = {}) {
    const results = await this.#tracks({ search: q, limit: String(limit) });
    return results.map(toTrack);
  }

  async getTrack(providerTrackId) {
    const [t] = await this.#tracks({ id: providerTrackId });
    return t ? toTrack(t) : null;
  }

  async getStreamUrl(providerTrackId) {
    const [t] = await this.#tracks({ id: providerTrackId });
    return t?.audio ?? null;
  }

  async topTracks(tag, { limit = 10, attempts = 4, retryDelayMs = 1000 } = {}) {
    for (let attempt = 1; ; attempt++) {
      const results = await this.#tracks({
        tags: tag,
        limit: String(limit),
        order: 'popularity_total',
      });
      if (results.length >= limit || attempt >= attempts) return results.map(toTrack);
      await sleep(retryDelayMs * attempt);
    }
  }

  async #tracks(params) {
    const results = await this.#request('/tracks/', { audioformat: 'mp32', ...params });
    return results.filter((t) => t.audio);
  }

  async #request(path, params) {
    if (!this.#clientId) {
      throw new HttpProblem(503, 'music_unavailable', {
        detail: 'JAMENDO_CLIENT_ID is not configured on this server',
      });
    }
    const query = new URLSearchParams({ client_id: this.#clientId, format: 'json', ...params });
    let body;
    try {
      const res = await this.#fetch(`${BASE_URL}${path}?${query}`, {
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = await res.json();
    } catch (err) {
      throw this.#providerError(path, err.message);
    }
    if (body.headers?.status !== 'success') {
      throw this.#providerError(path, body.headers?.error_message ?? 'unexpected answer');
    }
    return body.results ?? [];
  }

  #providerError(path, reason) {
    this.#log?.warn({ provider: 'jamendo', path, reason }, 'music provider request failed');
    return new HttpProblem(502, 'music_provider_error', {
      detail: 'The music catalog is unreachable, try again later',
      cause: new Error(`Jamendo ${path}: ${reason}`),
    });
  }
}

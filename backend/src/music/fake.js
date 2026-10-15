// In-memory catalog with the same interface as JamendoClient, for tests.
// Every call is recorded in `calls`; `catalog` can be edited between two calls.
export class FakeMusicClient {
  calls = [];

  constructor(catalog = DEFAULT_CATALOG) {
    this.catalog = catalog;
  }

  async search(q, { limit = 20 } = {}) {
    this.calls.push(['search', q, limit]);
    const needle = q.toLowerCase();
    return this.catalog
      .filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(needle))
      .slice(0, limit);
  }

  async getTrack(id) {
    this.calls.push(['getTrack', id]);
    return this.#find(id);
  }

  async getStreamUrl(id) {
    this.calls.push(['getStreamUrl', id]);
    if (this.#find(id) == null) return null;
    return `https://stream.test/${id}.mp3?signed=${this.calls.length}`;
  }

  async topTracks(tag, { limit = 10 } = {}) {
    this.calls.push(['topTracks', tag, limit]);
    return this.catalog.slice(0, limit);
  }

  #find(id) {
    return this.catalog.find((t) => t.providerTrackId === id) ?? null;
  }
}

function track(id, title, artist, durationMs) {
  return {
    provider: 'jamendo',
    providerTrackId: id,
    title,
    artist,
    durationMs,
    coverUrl: `https://cover.test/${id}.jpg`,
  };
}

export const DEFAULT_CATALOG = [
  track('1001', 'Night Drive', 'Neon Coast', 214000),
  track('1002', 'Night Market', 'Lumen', 187000),
  track('1003', 'Morning Light', 'Lumen', 243000),
  track('1004', 'Paper Planes', 'The Folds', 199000),
];

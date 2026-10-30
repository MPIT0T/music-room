function fromRow(row) {
  return {
    id: row.id,
    provider: row.provider,
    providerTrackId: row.provider_track_id,
    title: row.title,
    artist: row.artist,
    durationMs: row.duration_ms,
    coverUrl: row.cover_url,
  };
}

export const publicTrack = ({ id, title, artist, durationMs, coverUrl }) => ({
  id,
  title,
  artist,
  durationMs,
  coverUrl,
});

export async function upsertTracks(db, tracks) {
  if (tracks.length === 0) return [];
  const sorted = [...tracks].sort((a, b) =>
    `${a.provider}:${a.providerTrackId}`.localeCompare(`${b.provider}:${b.providerTrackId}`),
  );
  await db.query(
    `INSERT INTO tracks (provider, provider_track_id, title, artist, duration_ms, cover_url)
     VALUES ?
     ON DUPLICATE KEY UPDATE title = VALUES(title), artist = VALUES(artist),
       duration_ms = VALUES(duration_ms), cover_url = VALUES(cover_url)`,
    [
      sorted.map((t) => [
        t.provider,
        t.providerTrackId,
        t.title.slice(0, 255),
        t.artist.slice(0, 255),
        t.durationMs,
        t.coverUrl?.length <= 500 ? t.coverUrl : null,
      ]),
    ],
  );
  const [rows] = await db.query(
    `SELECT id, provider, provider_track_id, title, artist, duration_ms, cover_url
     FROM tracks WHERE (provider, provider_track_id) IN (?)`,
    [tracks.map((t) => [t.provider, t.providerTrackId])],
  );
  const byKey = new Map(rows.map((r) => [`${r.provider}:${r.provider_track_id}`, fromRow(r)]));
  return tracks.map((t) => byKey.get(`${t.provider}:${t.providerTrackId}`));
}

export async function findTrack(db, id) {
  const [[row]] = await db.query(
    `SELECT id, provider, provider_track_id, title, artist, duration_ms, cover_url
     FROM tracks WHERE id = ?`,
    [id],
  );
  return row ? fromRow(row) : null;
}

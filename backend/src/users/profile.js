// Profile reads for /v1/me and /v1/users/:id, grouped by visibility (contract, ACC-8):
// public = every signed-in user, friends = accepted friends, private = the owner only.

export async function genresOf(db, userId) {
  const [rows] = await db.query(
    `SELECT g.id, g.name FROM user_genres ug JOIN genres g ON g.id = ug.genre_id
     WHERE ug.user_id = ? ORDER BY g.name`,
    [userId],
  );
  return rows.map(({ id, name }) => ({ id: Number(id), name }));
}

// Read-only on purpose: the friends feature (requests, accept, remove) belongs to its own
// module. Both orders are checked so this does not depend on how rows are ordered.
export async function areFriends(db, a, b) {
  const [rows] = await db.query(
    `SELECT 1 FROM friendships
     WHERE status = 'accepted' AND ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?))
     LIMIT 1`,
    [a, b, b, a],
  );
  return rows.length > 0;
}

async function profileRow(db, userId, { withPrivate }) {
  const [[row]] = await db.query(
    withPrivate
      ? `SELECT u.id, u.display_name, u.avatar_url, u.bio, u.city, u.phone,
                u.email, u.password_hash IS NOT NULL AS has_password, u.email_verified_at, u.plan,
                u.real_name, DATE_FORMAT(u.birth_date, '%Y-%m-%d') AS birth_date,
                (SELECT GROUP_CONCAT(o.provider ORDER BY o.provider) FROM oauth_accounts o
                 WHERE o.user_id = u.id) AS oauth_providers
         FROM users u WHERE u.id = ?`
      : `SELECT u.id, u.display_name, u.avatar_url, u.bio, u.city, u.phone FROM users u WHERE u.id = ?`,
    [userId],
  );
  return row ?? null;
}

const publicGroup = (row, genres) => ({
  displayName: row.display_name,
  avatarUrl: row.avatar_url,
  bio: row.bio,
  genres,
});
const friendsGroup = (row) => ({ city: row.city, phone: row.phone });

// The `me` object of the contract; null if the account no longer exists
export async function loadMe(db, userId) {
  const row = await profileRow(db, userId, { withPrivate: true });
  if (!row) return null;
  const oauth = row.oauth_providers ? row.oauth_providers.split(',') : [];
  return {
    id: row.id,
    emailVerified: row.email_verified_at != null,
    plan: row.plan,
    providers: [...(row.has_password ? ['password'] : []), ...oauth],
    public: publicGroup(row, await genresOf(db, userId)),
    friends: friendsGroup(row),
    private: { realName: row.real_name, birthDate: row.birth_date, email: row.email },
  };
}

// What `viewerId` may see of `userId`: never the private group (see /v1/me for that)
export async function loadProfile(db, viewerId, userId) {
  const row = await profileRow(db, userId, { withPrivate: false });
  if (!row) return null;
  const relationship =
    viewerId === row.id ? 'self' : (await areFriends(db, viewerId, row.id)) ? 'friend' : 'none';
  return {
    id: row.id,
    relationship,
    public: publicGroup(row, await genresOf(db, row.id)),
    friends: relationship === 'none' ? null : friendsGroup(row),
  };
}

// Only the columns the auth routes need; password_hash never leaves this layer through toPublicUser
export async function findUserByEmail(db, email) {
  const [[row]] = await db.query(
    `SELECT u.id, u.email, u.password_hash, u.email_verified_at, u.display_name, u.avatar_url, u.plan,
            GROUP_CONCAT(o.provider) AS oauth_providers
     FROM users u
     LEFT JOIN oauth_accounts o ON o.user_id = u.id
     WHERE u.email = ?
     GROUP BY u.id`,
    [email],
  );
  return row ?? null;
}

// The "user" object of the contract
export function toPublicUser(row) {
  const oauth = row.oauth_providers ? row.oauth_providers.split(',') : [];
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.email_verified_at != null,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    plan: row.plan,
    providers: [...(row.password_hash ? ['password'] : []), ...oauth],
  };
}

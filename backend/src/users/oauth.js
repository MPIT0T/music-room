// The account-linking rules of POST /v1/sessions/oauth (contract, "Règles de liaison").
// Runs inside a transaction. Returns an outcome; userId is set when a session may be opened.
export async function signInWithGoogle(conn, { sub, email, emailVerified, name }) {
  // Rule 1: this Google account is already linked
  const [[linked]] = await conn.query(
    "SELECT user_id FROM oauth_accounts WHERE provider = 'google' AND provider_user_id = ?",
    [sub],
  );
  if (linked) return { outcome: 'login', userId: linked.user_id };

  // Linking or creating on an unverified address would let anyone claim someone else's email
  if (!emailVerified || !email) return { outcome: 'email_not_verified' };

  // Rule 2: a local account with the same email. FOR UPDATE: two sign-ins cannot both link it.
  const [[local]] = await conn.query(
    `SELECT id, email_verified_at,
            (SELECT o.provider_user_id FROM oauth_accounts o
             WHERE o.user_id = users.id AND o.provider = 'google') AS google_sub
     FROM users WHERE email = ? FOR UPDATE`,
    [email],
  );
  if (local) {
    // Linked meanwhile by a concurrent sign-in with this same Google account
    if (local.google_sub === sub) return { outcome: 'login', userId: local.id };
    if (local.google_sub) return { outcome: 'already_linked' };
    if (!local.email_verified_at) {
      // Pre-hijacking: whoever chose this password never proved owning the address
      await conn.query(
        'UPDATE users SET password_hash = NULL, email_verified_at = NOW(3) WHERE id = ?',
        [local.id],
      );
      await conn.query('DELETE FROM email_tokens WHERE user_id = ?', [local.id]);
    }
    await linkGoogle(conn, local.id, sub);
    return { outcome: 'linked', userId: local.id };
  }

  // Rule 3: new account, email verified by Google, no password
  const [[created]] = await conn.query(
    'INSERT INTO users (email, email_verified_at, display_name) VALUES (?, NOW(3), ?) RETURNING id',
    [email, name],
  );
  await linkGoogle(conn, created.id, sub);
  return { outcome: 'created', userId: created.id };
}

async function linkGoogle(conn, userId, sub) {
  await conn.query(
    "INSERT INTO oauth_accounts (user_id, provider, provider_user_id) VALUES (?, 'google', ?)",
    [userId, sub],
  );
}

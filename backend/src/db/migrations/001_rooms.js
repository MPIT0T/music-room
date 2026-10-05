// Migration idempotente (IF NOT EXISTS) : on peut relancer `make migrate` sans risque.
// NOTE : owner_id / user_id n'ont pas de FOREIGN KEY pour l'instant, la table `users`
// est faite par l'auth. A ajouter une fois qu'elle existe.
export async function up(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id            CHAR(36)     PRIMARY KEY,               -- UUID genere cote API
      owner_id      INT          NOT NULL,
      name          VARCHAR(100) NOT NULL,
      visibility    ENUM('public','private') NOT NULL DEFAULT 'public',
      vote_license  ENUM('open','invited_only','geo_time') NOT NULL DEFAULT 'open',
      geo_lat       DECIMAL(9,6) NULL,
      geo_lng       DECIMAL(9,6) NULL,
      geo_radius_m  INT          NULL,
      window_start  DATETIME     NULL,                      -- toujours en UTC
      window_end    DATETIME     NULL,
      version       INT          NOT NULL DEFAULT 1,        -- servira au resync Socket.IO / If-Match
      created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Une ligne = un utilisateur lie a une room. Pas de ligne = simple visiteur
  // (autorise seulement si la room est publique).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_members (
      room_id  CHAR(36) NOT NULL,
      user_id  INT      NOT NULL,
      role     ENUM('owner','invited') NOT NULL DEFAULT 'invited',
      PRIMARY KEY (room_id, user_id),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    )
  `);
}

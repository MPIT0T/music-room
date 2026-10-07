SET NAMES utf8mb4;
SET default_storage_engine = InnoDB;

CREATE TABLE users (
    id                 UUID          NOT NULL DEFAULT uuid_v7() PRIMARY KEY,
    email              VARCHAR(255)  NULL UNIQUE,
    password_hash      VARCHAR(255)  NULL,
    email_verified_at  DATETIME(3)   NULL,
    display_name       VARCHAR(50)   NOT NULL,
    avatar_url         VARCHAR(500)  NULL,
    bio                VARCHAR(500)  NULL,
    city               VARCHAR(100)  NULL,
    phone              VARCHAR(30)   NULL,
    real_name          VARCHAR(100)  NULL,
    birth_date         DATE          NULL,
    plan               ENUM('free','premium') NOT NULL DEFAULT 'free',
    created_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT chk_has_login CHECK (email IS NOT NULL OR password_hash IS NULL)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE oauth_accounts (
    user_id           UUID          NOT NULL,
    provider          ENUM('google','facebook') NOT NULL,
    provider_user_id  VARCHAR(255)  NOT NULL,
    created_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (user_id, provider),
    UNIQUE KEY uq_provider_account (provider, provider_user_id),
    CONSTRAINT fk_oauth_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE email_tokens (
    token_hash  CHAR(64)     NOT NULL PRIMARY KEY,
    user_id     UUID         NOT NULL,
    type        ENUM('verify_email','reset_password') NOT NULL,
    expires_at  DATETIME(3)  NOT NULL,
    CONSTRAINT fk_email_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE devices (
    id                   UUID          NOT NULL PRIMARY KEY,
    user_id              UUID          NOT NULL,
    name                 VARCHAR(100)  NOT NULL,
    platform             ENUM('android','ios','web') NOT NULL,
    model                VARCHAR(100)  NULL,
    app_version          VARCHAR(20)   NULL,
    refresh_hash         CHAR(64)      NULL UNIQUE,
    previous_refresh_hash CHAR(64)     NULL,
    refresh_expires_at   DATETIME(3)   NULL,
    rotated_at           DATETIME(3)   NULL,
    last_seen_at         DATETIME(3)   NULL,
    created_at           DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_devices_user (user_id),
    KEY idx_devices_previous (previous_refresh_hash),
    CONSTRAINT fk_devices_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE friendships (
    user_a        UUID         NOT NULL,
    user_b        UUID         NOT NULL,
    requested_by  UUID         NOT NULL,
    status        ENUM('pending','accepted') NOT NULL DEFAULT 'pending',
    created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (user_a, user_b),
    KEY idx_friend_b (user_b),
    CONSTRAINT chk_ordered   CHECK (user_a < user_b),
    CONSTRAINT chk_requester CHECK (requested_by IN (user_a, user_b)),
    CONSTRAINT fk_fr_a FOREIGN KEY (user_a) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_fr_b FOREIGN KEY (user_b) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE genres (
    id    SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name  VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE user_genres (
    user_id   UUID              NOT NULL,
    genre_id  SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (user_id, genre_id),
    CONSTRAINT fk_ug_user  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
    CONSTRAINT fk_ug_genre FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE CASCADE
);

CREATE TABLE tracks (
    id                 UUID          NOT NULL DEFAULT uuid_v7() PRIMARY KEY,
    provider           ENUM('deezer','jamendo') NOT NULL,
    provider_track_id  VARCHAR(100)  NOT NULL,
    title              VARCHAR(255)  NOT NULL,
    artist             VARCHAR(255)  NOT NULL,
    duration_ms        INT UNSIGNED  NULL,
    cover_url          VARCHAR(500)  NULL,
    UNIQUE KEY uq_provider_track (provider, provider_track_id)
);

CREATE TABLE rooms (
    id              UUID          NOT NULL DEFAULT uuid_v7() PRIMARY KEY,
    owner_id        UUID          NOT NULL,
    name            VARCHAR(100)  NOT NULL,
    description     VARCHAR(1000) NULL,
    visibility      ENUM('public','private') NOT NULL DEFAULT 'public',
    access_policy   ENUM('everyone','invited','geo_time') NOT NULL DEFAULT 'everyone',
    latitude        DECIMAL(9,6)  NULL,
    longitude       DECIMAL(9,6)  NULL,
    radius_m        INT UNSIGNED  NULL,
    starts_at       DATETIME(3)   NULL,
    ends_at         DATETIME(3)   NULL,
    beacon_minor    SMALLINT UNSIGNED NULL UNIQUE,
    version         BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    KEY idx_rooms_discover (visibility),
    KEY idx_rooms_owner (owner_id),
    CONSTRAINT chk_geo_complete CHECK (
        access_policy <> 'geo_time'
        OR (latitude IS NOT NULL AND longitude IS NOT NULL AND radius_m IS NOT NULL
            AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at)
    ),
    CONSTRAINT fk_rooms_owner FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE room_members (
    room_id     UUID         NOT NULL,
    user_id     UUID         NOT NULL,
    joined_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (room_id, user_id),
    KEY idx_rm_user (user_id),
    CONSTRAINT fk_rm_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    CONSTRAINT fk_rm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE room_tracks (
    id               UUID          NOT NULL DEFAULT uuid_v7() PRIMARY KEY,
    room_id          UUID          NOT NULL,
    track_id         UUID          NOT NULL,
    added_by         UUID          NULL,
    status           ENUM('queued','playing','played') NOT NULL DEFAULT 'queued',
    active_track_id  UUID AS (IF(status = 'played', NULL, track_id)) STORED,
    created_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_room_active_track (room_id, active_track_id),
    KEY idx_rt_room_status (room_id, status, created_at),
    CONSTRAINT fk_rt_room  FOREIGN KEY (room_id)  REFERENCES rooms(id)  ON DELETE CASCADE,
    CONSTRAINT fk_rt_track FOREIGN KEY (track_id) REFERENCES tracks(id),
    CONSTRAINT fk_rt_user  FOREIGN KEY (added_by) REFERENCES users(id)  ON DELETE SET NULL
);

CREATE TABLE votes (
    room_track_id  UUID         NOT NULL,
    user_id        UUID         NOT NULL,
    created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (room_track_id, user_id),
    KEY idx_votes_user (user_id),
    CONSTRAINT fk_votes_rt   FOREIGN KEY (room_track_id) REFERENCES room_tracks(id) ON DELETE CASCADE,
    CONSTRAINT fk_votes_user FOREIGN KEY (user_id)       REFERENCES users(id)       ON DELETE CASCADE
);

CREATE TABLE control_delegations (
    device_id         UUID         NOT NULL,
    delegate_user_id  UUID         NOT NULL,
    expires_at        DATETIME(3)  NULL,
    created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (device_id, delegate_user_id),
    KEY idx_deleg_delegate (delegate_user_id),
    CONSTRAINT fk_cd_device   FOREIGN KEY (device_id)        REFERENCES devices(id) ON DELETE CASCADE,
    CONSTRAINT fk_cd_delegate FOREIGN KEY (delegate_user_id) REFERENCES users(id)   ON DELETE CASCADE
);

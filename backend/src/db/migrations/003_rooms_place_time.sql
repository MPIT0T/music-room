-- time_window becomes place_time: the place (latitude, longitude, radius_m) is required with it.
-- Safe to re-run: MariaDB commits each ALTER on its own, so a failed run can leave part of it applied.

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS chk_time_window_set;

ALTER TABLE rooms MODIFY access_policy
    ENUM('everyone','invited','time_window','place_time') NOT NULL DEFAULT 'everyone';
-- A room with a place keeps its licence; without one it cannot be checked, so it opens to everyone
UPDATE rooms SET access_policy = 'place_time'
 WHERE access_policy = 'time_window' AND latitude IS NOT NULL;
UPDATE rooms SET access_policy = 'everyone' WHERE access_policy = 'time_window';
ALTER TABLE rooms MODIFY access_policy
    ENUM('everyone','invited','place_time') NOT NULL DEFAULT 'everyone';

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS chk_place_time_set;
ALTER TABLE rooms ADD CONSTRAINT chk_place_time_set CHECK (
    access_policy <> 'place_time' OR (starts_at IS NOT NULL AND latitude IS NOT NULL)
);

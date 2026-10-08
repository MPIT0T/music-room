-- Safe to re-run: MariaDB commits each ALTER on its own, so a failed run can leave part of it applied.

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS chk_geo_complete;

ALTER TABLE rooms MODIFY access_policy
    ENUM('everyone','invited','geo_time','time_window') NOT NULL DEFAULT 'everyone';
UPDATE rooms SET access_policy = 'time_window' WHERE access_policy = 'geo_time';
ALTER TABLE rooms MODIFY access_policy
    ENUM('everyone','invited','time_window') NOT NULL DEFAULT 'everyone';

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS chk_window_complete;
ALTER TABLE rooms ADD CONSTRAINT chk_window_complete CHECK (
    (starts_at IS NULL AND ends_at IS NULL)
    OR (starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at)
);

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS chk_time_window_set;
ALTER TABLE rooms ADD CONSTRAINT chk_time_window_set CHECK (
    access_policy <> 'time_window' OR starts_at IS NOT NULL
);

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS chk_location_complete;
ALTER TABLE rooms ADD CONSTRAINT chk_location_complete CHECK (
    (latitude IS NULL AND longitude IS NULL AND radius_m IS NULL)
    OR (
        latitude BETWEEN -90 AND 90
        AND longitude BETWEEN -180 AND 180
        AND radius_m > 0
    )
);

-- Issue #60: 個別案件の車両所有元を企業／パートナーで識別する

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS vehicle_owner_type ENUM('company','partner') NULL AFTER vehicle_id;

UPDATE projects p
LEFT JOIN company_vehicles cv
  ON cv.vehicle_id = p.vehicle_id
 AND cv.company_id = p.company_id
 AND cv.is_deleted = 0
LEFT JOIN partner_vehicles pv
  ON pv.vehicle_id = p.vehicle_id
 AND pv.partner_id = p.partner_id
 AND pv.is_deleted = 0
SET p.vehicle_owner_type = CASE
  WHEN cv.vehicle_id IS NOT NULL AND pv.vehicle_id IS NULL THEN 'company'
  WHEN cv.vehicle_id IS NULL AND pv.vehicle_id IS NOT NULL THEN 'partner'
  ELSE NULL
END
WHERE p.vehicle_id IS NOT NULL
  AND p.vehicle_owner_type IS NULL;

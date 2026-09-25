-- Only add the shared group reference. Rates, order and analysis/review status stay unchanged.
UPDATE price_sets p
SET p.extra_data=JSON_SET(p.extra_data,'$.fee_items',JSON_QUERY((
  SELECT JSON_ARRAYAGG(JSON_SET(j.item,'$.logic_group_code',
    COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(j.item,'$.logic_group_code')),'null'),
      CASE
        WHEN JSON_SEARCH(j.item,'one','daily_basic',NULL,'$.rows[*].item_type') IS NOT NULL THEN 'daily'
        WHEN JSON_SEARCH(j.item,'one','hourly',NULL,'$.rows[*].item_type') IS NOT NULL THEN 'hourly'
        WHEN JSON_SEARCH(j.item,'one','unit',NULL,'$.rows[*].item_type') IS NOT NULL THEN 'quantity'
        WHEN JSON_SEARCH(j.item,'one','distance',NULL,'$.rows[*].item_type') IS NOT NULL
          OR JSON_UNQUOTE(JSON_EXTRACT(j.item,'$.mode'))='distance' THEN 'distance'
        WHEN JSON_SEARCH(j.item,'one','daily',NULL,'$.calc_types[*]') IS NOT NULL THEN 'daily'
        ELSE 'hourly'
      END)) ORDER BY j.ord)
  FROM JSON_TABLE(p.extra_data,'$.fee_items[*]' COLUMNS(ord FOR ORDINALITY,item JSON PATH '$')) j
),'$')),p.version=p.version+1
WHERE p.is_deleted=0 AND JSON_LENGTH(JSON_EXTRACT(p.extra_data,'$.fee_items'))>0;

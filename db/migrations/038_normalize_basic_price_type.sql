-- Normalize workbooks created by the first master-data import implementation.
-- The pricing engine and code master use "basic" for the regular daily fee.
UPDATE price_set_lines
SET price_type_code = 'basic'
WHERE price_type_code = 'base';

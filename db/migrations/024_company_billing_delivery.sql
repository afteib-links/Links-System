ALTER TABLE company_billings
  ADD COLUMN billing_zip_code VARCHAR(20) NULL AFTER billing_print_name,
  ADD COLUMN billing_email VARCHAR(255) NULL AFTER billing_fax,
  ADD COLUMN invoice_send_method VARCHAR(50) NULL AFTER billing_email;

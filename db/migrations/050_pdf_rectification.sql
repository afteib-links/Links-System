-- Original PDFs remain unchanged. Derived images and their coordinates share one space.
ALTER TABLE daily_report_pdf_pages
  ADD COLUMN IF NOT EXISTS rectification JSON NULL;

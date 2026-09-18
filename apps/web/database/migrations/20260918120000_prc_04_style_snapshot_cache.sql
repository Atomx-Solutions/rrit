-- PRC-04: the monthly page-style fetch is cached for a whole month. The
-- contact sheet of the fetched posts is stored privately so cached
-- generations need neither Meta nor the AI provider again.
ALTER TABLE style_snapshots ADD COLUMN contact_sheet_path text;

-- Migration 0004: read-only client portal token (additive only).
-- 128-bit capability, 'rcp_' + 32 hex, generated at invoice creation.
-- Existing invoices stay NULL (no backfill); NULLs are distinct in the
-- unique index, so old rows are unaffected and unreachable via /r/:token.
ALTER TABLE invoices ADD COLUMN portal_token TEXT;
CREATE UNIQUE INDEX idx_invoices_portal_token ON invoices (portal_token);

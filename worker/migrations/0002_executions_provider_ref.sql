-- Migration 0002: executions carry the wallet-provider transaction reference
-- (Circle transaction UUID) so a restarted orchestrator can reconcile
-- intent/sent rows against provider + chain state before acting (SPEC §3.2).
ALTER TABLE executions ADD COLUMN provider_ref TEXT;

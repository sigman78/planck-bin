-- Migration: Burn-after-reading flag
-- Description: rows with burn = 1 are deleted by their first full read
-- (DELETE ... RETURNING). Every access is by primary key, so no index.

ALTER TABLE documents ADD COLUMN burn INTEGER NOT NULL DEFAULT 0;

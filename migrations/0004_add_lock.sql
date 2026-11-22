-- Migration: Protected pastes
-- Description: rows with lock_salt set hold ciphertext encrypted in the
-- browser. lock_verifier is SHA-256 of the unlock token (base64url); the
-- content leaves the worker only after a matching token. lock_failures counts
-- unlock attempts that did not succeed; the row is deleted at the cap.

ALTER TABLE documents ADD COLUMN lock_salt TEXT;
ALTER TABLE documents ADD COLUMN lock_verifier TEXT;
ALTER TABLE documents ADD COLUMN lock_failures INTEGER NOT NULL DEFAULT 0;

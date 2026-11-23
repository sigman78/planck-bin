-- Migration: Owners and private pastes
-- Description: owner holds the uid of the signed-in user who created the row
-- (a hash of the OIDC issuer and subject; no names or emails are stored), or
-- NULL for anonymous pastes. private = 1 rows are readable by their owner
-- only. The partial index serves the "My pastes" list; anonymous rows pay no
-- index write.

ALTER TABLE documents ADD COLUMN owner TEXT;
ALTER TABLE documents ADD COLUMN private INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_documents_owner ON documents(owner, created_at, id) WHERE owner IS NOT NULL;

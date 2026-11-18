-- Migration: Drop the unused created_at index
-- Description: No query filters or sorts on created_at, so the index only
-- added a write to every insert and delete. (The db:inspect dev script still
-- sorts by created_at; on a dev database a full scan is fine.)

DROP INDEX IF EXISTS idx_documents_created_at;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "documents" ADD COLUMN "search_vector" tsvector;
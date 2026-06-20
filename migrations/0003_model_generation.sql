-- Migration: Add model and generation columns (applied ad-hoc during initial build)
-- Safe to re-run: uses IF NOT EXISTS / catches errors

-- Add model to jobs (default matches what was set during initial build)
ALTER TABLE jobs ADD COLUMN model TEXT NOT NULL DEFAULT 'anthropic/claude-opus-4-6';

-- Add model to tasks
ALTER TABLE tasks ADD COLUMN model TEXT;

-- Add generation counter for restart safety
ALTER TABLE jobs ADD COLUMN generation INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN generation INTEGER NOT NULL DEFAULT 1;

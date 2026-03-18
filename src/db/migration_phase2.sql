-- ============================================================
-- Mediko Chat — Phase 2 Migration
-- Run in Supabase SQL Editor AFTER the Phase 1 migration.
-- ============================================================

-- Add channel-agnostic columns to chat_sessions
ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS mode          TEXT NOT NULL DEFAULT 'ai'
                                         CHECK (mode IN ('ai', 'agent')),
  ADD COLUMN IF NOT EXISTS channel       TEXT NOT NULL DEFAULT 'widget'
                                         CHECK (channel IN ('widget', 'whatsapp', 'messenger', 'sms')),
  ADD COLUMN IF NOT EXISTS channel_user_id TEXT,          -- e.g. WhatsApp phone number or PSID
  ADD COLUMN IF NOT EXISTS assigned_agent TEXT,           -- agent identifier (email or name)
  ADD COLUMN IF NOT EXISTS handoff_at    TIMESTAMPTZ;     -- when handoff was requested

-- Index for agent dashboard queries (all sessions in agent mode)
CREATE INDEX IF NOT EXISTS idx_sessions_mode
  ON chat_sessions(mode, last_active DESC);

-- Index for channel lookups (find session by WhatsApp/Messenger user ID)
CREATE INDEX IF NOT EXISTS idx_sessions_channel_user
  ON chat_sessions(channel, channel_user_id)
  WHERE channel_user_id IS NOT NULL;

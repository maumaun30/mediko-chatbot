-- ============================================================
-- Mediko AI Chatbot — Supabase Migration
-- Run this in your Supabase SQL Editor or via supabase db push
-- ============================================================

-- Chat sessions table
CREATE TABLE IF NOT EXISTS chat_sessions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL    DEFAULT now(),
  last_active   TIMESTAMPTZ NOT NULL    DEFAULT now(),
  customer_email TEXT,
  metadata      JSONB
);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role        TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  tokens_used INTEGER
);

-- Index for fast history lookups
CREATE INDEX IF NOT EXISTS idx_chat_messages_session
  ON chat_messages(session_id, created_at DESC);

-- ── Row Level Security ──────────────────────────────────────
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- NOTE: The service_role key bypasses RLS entirely — these policies
-- are a safety net for any future anon/client-side access.
-- Our Fastify backend uses service_role and is unaffected by them,
-- but ALL operations need a matching policy or Postgres will block
-- non-service-role callers (including if you accidentally used the anon key).

-- chat_sessions: allow all operations
CREATE POLICY "sessions_select" ON chat_sessions
  FOR SELECT USING (true);

CREATE POLICY "sessions_insert" ON chat_sessions
  FOR INSERT WITH CHECK (true);

CREATE POLICY "sessions_update" ON chat_sessions
  FOR UPDATE USING (true);

-- chat_messages: allow all operations
CREATE POLICY "messages_select" ON chat_messages
  FOR SELECT USING (true);

CREATE POLICY "messages_insert" ON chat_messages
  FOR INSERT WITH CHECK (true);

-- ── If you already ran the old migration, run these to patch: ──
-- DROP POLICY IF EXISTS "session_owner_select" ON chat_sessions;
-- DROP POLICY IF EXISTS "session_owner_select_messages" ON chat_messages;
-- Then re-run the CREATE POLICY statements above.

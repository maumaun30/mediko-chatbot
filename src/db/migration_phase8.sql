-- ============================================================
-- Mediko Chat — Phase 8 Migration: Quick Replies
-- Run in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_quick_replies (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  label      TEXT        NOT NULL,          -- button text shown to customer
  message    TEXT        NOT NULL,          -- message sent when clicked
  sort_order INTEGER     NOT NULL DEFAULT 0,
  active     BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed with defaults
INSERT INTO chat_quick_replies (label, message, sort_order) VALUES
  ('Ano ang mga produkto ninyo?',   'Ano ang mga produkto ninyo?',           1),
  ('Para sa kasukasuan at joints',  'May supplement ba para sa kasukasuan?', 2),
  ('Para sa immune system',         'May pang-immunity ba kayong supplement?',3),
  ('Saan na ang aking order?',      'Saan na ang aking order?',              4),
  ('Makausap ng agent',             'agent',                                  5)
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_quick_replies_active
  ON chat_quick_replies(active, sort_order);

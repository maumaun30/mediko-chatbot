-- ============================================================
-- Mediko Chat — Phase 7 Migration: Dynamic Keywords
-- Run in Supabase SQL Editor
-- ============================================================

-- Keywords table: maps trigger patterns → Shopify search terms
CREATE TABLE IF NOT EXISTS chat_keywords (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern     TEXT        NOT NULL,           -- phrase/word to detect in message
  search_term TEXT        NOT NULL,           -- Shopify search term to use
  category    TEXT        NOT NULL DEFAULT 'health',  -- grouping label
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed with sensible defaults (mirrors the old hardcoded HEALTH_KEYWORD_MAP)
INSERT INTO chat_keywords (pattern, search_term, category) VALUES
  -- Immunity
  ('immune',       'immunity',    'health'),
  ('immunity',     'immunity',    'health'),
  ('imunan',       'immunity',    'health'),
  ('resistensya',  'immunity',    'health'),
  ('ubo',          'immunity',    'health'),
  ('sipon',        'immunity',    'health'),
  ('flu',          'immunity',    'health'),
  -- Joints / Collagen (for Genacol-type products)
  ('genacol',      'genacol',     'product'),
  ('collagen',     'collagen',    'health'),
  ('joints',       'collagen',    'health'),
  ('kasukasuan',   'collagen',    'health'),
  ('arthritis',    'collagen',    'health'),
  -- Sleep
  ('tulog',        'sleep',       'health'),
  ('sleep',        'sleep',       'health'),
  ('insomnia',     'melatonin',   'health'),
  ('hirap matulog','melatonin',   'health'),
  -- Energy
  ('energy',       'energy',      'health'),
  ('lakas',        'energy',      'health'),
  ('pagod',        'energy',      'health'),
  ('tired',        'energy',      'health'),
  ('fatigue',      'energy',      'health'),
  -- Bones
  ('buto',         'calcium',     'health'),
  ('osteoporosis', 'calcium',     'health'),
  ('calcium',      'calcium',     'health'),
  -- Skin
  ('skin',         'collagen',    'health'),
  ('balat',        'collagen',    'health'),
  ('glow',         'glutathione', 'health'),
  ('whitening',    'glutathione', 'health'),
  ('glutathione',  'glutathione', 'product'),
  -- Heart
  ('puso',         'omega 3',     'health'),
  ('heart',        'omega 3',     'health'),
  ('cholesterol',  'omega 3',     'health'),
  -- Digestion
  ('tiyan',        'probiotic',   'health'),
  ('digest',       'probiotic',   'health'),
  ('probiotic',    'probiotic',   'product'),
  -- Stress
  ('stress',       'magnesium',   'health'),
  ('anxiety',      'magnesium',   'health'),
  -- Weight
  ('weight',       'slimming',    'health'),
  ('timbang',      'slimming',    'health'),
  ('diet',         'slimming',    'health'),
  -- Vitamins
  ('vitamin c',    'vitamin c',   'product'),
  ('vitamin d',    'vitamin d',   'product'),
  ('multivitamin', 'multivitamin','product'),
  ('bitamina',     'multivitamin','health')
ON CONFLICT DO NOTHING;

-- Index for fast pattern lookups
CREATE INDEX IF NOT EXISTS idx_keywords_active
  ON chat_keywords(active, pattern);

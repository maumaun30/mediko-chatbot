-- Phase 10: Settings table for business hours, idle timeout, etc.
CREATE TABLE IF NOT EXISTS chat_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO chat_settings (key, value) VALUES
  ('business_hours', '{"enabled":false,"timezone":"Asia/Manila","awayMessage":"Pasensya na po, wala kaming available na agent sa ngayon. Maaari kayong mag-iwan ng mensahe at tutugon kami sa lalong madaling panahon.","hours":{"mon":{"open":true,"start":"08:00","end":"18:00"},"tue":{"open":true,"start":"08:00","end":"18:00"},"wed":{"open":true,"start":"08:00","end":"18:00"},"thu":{"open":true,"start":"08:00","end":"18:00"},"fri":{"open":true,"start":"08:00","end":"18:00"},"sat":{"open":false,"start":"09:00","end":"13:00"},"sun":{"open":false,"start":"09:00","end":"13:00"}}}'),
  ('idle_minutes', '{"value":30}')
ON CONFLICT (key) DO NOTHING;

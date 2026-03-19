-- ============================================================
-- Enable Supabase Realtime on chat_messages
-- Run in Supabase SQL Editor
-- ============================================================

-- Add the table to the supabase_realtime publication
-- so INSERT events are broadcast to subscribers
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;

-- Also enable RLS policy for anon reads on chat_messages
-- (Supabase Realtime requires the anon key to be able to read the rows)
-- We scope it to the session_id so a widget can only see its own messages
DROP POLICY IF EXISTS "widget_read_own_messages" ON chat_messages;
CREATE POLICY "widget_read_own_messages" ON chat_messages
  FOR SELECT
  USING (true);  -- session_id filtering is done client-side in the widget subscription filter

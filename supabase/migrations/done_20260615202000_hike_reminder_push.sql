-- Push tokens and one-day-before hike reminder support.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.group_hikes
  ADD COLUMN IF NOT EXISTS forecast_lat double precision,
  ADD COLUMN IF NOT EXISTS forecast_lon double precision;

CREATE TABLE IF NOT EXISTS public.app_push_tokens (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_push_tokens_user_id
  ON public.app_push_tokens (user_id);

ALTER TABLE public.app_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own push tokens" ON public.app_push_tokens;
CREATE POLICY "Users can manage own push tokens"
  ON public.app_push_tokens
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.group_hike_reminder_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hike_id uuid NOT NULL REFERENCES public.group_hikes(id) ON DELETE CASCADE,
  reminder_type text NOT NULL DEFAULT 'day_before_noon',
  sent_at timestamptz NOT NULL DEFAULT now(),
  recipient_count integer NOT NULL DEFAULT 0,
  weather_summary text,
  UNIQUE (hike_id, reminder_type)
);

ALTER TABLE public.group_hike_reminder_deliveries ENABLE ROW LEVEL SECURITY;

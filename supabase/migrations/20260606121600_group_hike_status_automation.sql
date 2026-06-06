-- Group hike status automation.
-- Apply this migration in Supabase, then wire `refresh_group_hike_statuses`
-- to a Scheduled Job or Edge Function for periodic server-side transitions.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.group_hikes
  DROP CONSTRAINT IF EXISTS group_hikes_status_check;

ALTER TABLE public.group_hikes
  ADD COLUMN IF NOT EXISTS start_time timestamptz,
  ADD COLUMN IF NOT EXISTS completed_member_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completion_threshold integer,
  ADD COLUMN IF NOT EXISTS manually_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.group_hikes
SET start_time = meeting_at
WHERE start_time IS NULL
  AND meeting_at IS NOT NULL;

UPDATE public.group_hikes
SET status = CASE status
  WHEN 'planned' THEN 'SCHEDULED'
  WHEN 'completed' THEN 'COMPLETED'
  ELSE status
END;

ALTER TABLE public.group_hikes
  ALTER COLUMN status SET DEFAULT 'SCHEDULED',
  ADD CONSTRAINT group_hikes_status_check
    CHECK (status IN ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED'));

CREATE INDEX IF NOT EXISTS idx_group_hikes_status_start_time
  ON public.group_hikes (status, start_time);

ALTER TABLE public.group_hike_attendance
  DROP CONSTRAINT IF EXISTS group_hike_attendance_participation_status_check;

ALTER TABLE public.group_hike_attendance
  ADD COLUMN IF NOT EXISTS participation_status text NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS local_session_id text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz;

ALTER TABLE public.group_hike_attendance
  ADD CONSTRAINT group_hike_attendance_participation_status_check
    CHECK (participation_status IN ('NOT_STARTED', 'RECORDING', 'FINISHED'));

CREATE INDEX IF NOT EXISTS idx_group_hike_attendance_status
  ON public.group_hike_attendance (hike_id, participation_status);

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS group_hike_id uuid REFERENCES public.group_hikes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS group_hike_title text;

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_settings (key, value)
VALUES
  ('GROUP_HIKE_COMPLETION_THRESHOLD', '2'::jsonb),
  ('GROUP_HIKE_EXPIRE_AFTER_MINUTES', '1440'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.group_hike_settings (
  group_hike_id uuid PRIMARY KEY REFERENCES public.group_hikes(id) ON DELETE CASCADE,
  completion_threshold integer,
  expire_after_minutes integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.group_hike_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_hike_id uuid NOT NULL REFERENCES public.group_hikes(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  reason text NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_group_hike_status_events_hike_created
  ON public.group_hike_status_events (group_hike_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.app_setting_int(p_key text, p_default integer)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((value #>> '{}')::integer, p_default)
  FROM public.app_settings
  WHERE key = p_key
  UNION ALL
  SELECT p_default
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.log_group_hike_status_event(
  p_hike_id uuid,
  p_from_status text,
  p_to_status text,
  p_reason text,
  p_actor_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_from_status IS DISTINCT FROM p_to_status THEN
    INSERT INTO public.group_hike_status_events (
      group_hike_id,
      from_status,
      to_status,
      reason,
      actor_id,
      metadata
    )
    VALUES (
      p_hike_id,
      p_from_status,
      p_to_status,
      p_reason,
      p_actor_id,
      COALESCE(p_metadata, '{}'::jsonb)
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_group_hike(p_hike_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.group_hikes h
    JOIN public.groups g ON g.id = h.group_id
    WHERE h.id = p_hike_id
      AND (h.creator_id = p_user_id OR g.creator_id = p_user_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.recompute_group_hike_status(p_hike_id uuid)
RETURNS public.group_hikes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hike public.group_hikes%ROWTYPE;
  v_updated public.group_hikes%ROWTYPE;
  v_old_status text;
  v_next_status text;
  v_completed_count integer;
  v_recording_count integer;
  v_threshold integer;
  v_expire_minutes integer;
  v_start_time timestamptz;
  v_expire_at timestamptz;
BEGIN
  SELECT *
  INTO v_hike
  FROM public.group_hikes
  WHERE id = p_hike_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group hike not found';
  END IF;

  v_old_status := v_hike.status;
  v_start_time := COALESCE(v_hike.start_time, v_hike.meeting_at);

  SELECT
    COUNT(*) FILTER (WHERE participation_status = 'FINISHED'),
    COUNT(*) FILTER (WHERE participation_status = 'RECORDING')
  INTO v_completed_count, v_recording_count
  FROM public.group_hike_attendance
  WHERE hike_id = p_hike_id;

  SELECT COALESCE(
    v_hike.completion_threshold,
    s.completion_threshold,
    public.app_setting_int('GROUP_HIKE_COMPLETION_THRESHOLD', 2)
  )
  INTO v_threshold
  FROM (SELECT 1) anchor
  LEFT JOIN public.group_hike_settings s ON s.group_hike_id = p_hike_id;

  SELECT COALESCE(
    s.expire_after_minutes,
    public.app_setting_int('GROUP_HIKE_EXPIRE_AFTER_MINUTES', 1440)
  )
  INTO v_expire_minutes
  FROM (SELECT 1) anchor
  LEFT JOIN public.group_hike_settings s ON s.group_hike_id = p_hike_id;

  v_expire_at := date_trunc('day', v_start_time) + interval '1 day' + make_interval(mins => v_expire_minutes);

  IF v_hike.status = 'CANCELLED' THEN
    v_next_status := 'CANCELLED';
  ELSIF v_hike.manually_completed_at IS NOT NULL THEN
    v_next_status := 'COMPLETED';
  ELSIF v_completed_count >= v_threshold THEN
    v_next_status := 'COMPLETED';
  ELSIF now() >= v_expire_at AND v_completed_count = 0 AND v_recording_count = 0 THEN
    v_next_status := 'EXPIRED';
  ELSIF now() >= v_start_time THEN
    v_next_status := 'IN_PROGRESS';
  ELSE
    v_next_status := 'SCHEDULED';
  END IF;

  UPDATE public.group_hikes
  SET
    status = v_next_status,
    completed_member_count = v_completed_count,
    completed_at = CASE
      WHEN v_next_status = 'COMPLETED' THEN COALESCE(completed_at, now())
      ELSE NULL
    END,
    updated_at = now()
  WHERE id = p_hike_id
  RETURNING * INTO v_updated;

  PERFORM public.log_group_hike_status_event(
    p_hike_id,
    v_old_status,
    v_next_status,
    'auto_recompute',
    NULL,
    jsonb_build_object(
      'completed_member_count', v_completed_count,
      'recording_member_count', v_recording_count,
      'completion_threshold', v_threshold,
      'expire_after_minutes', v_expire_minutes
    )
  );

  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_group_hike_statuses(p_group_id uuid DEFAULT NULL)
RETURNS SETOF public.group_hikes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hike_id uuid;
BEGIN
  FOR v_hike_id IN
    SELECT id
    FROM public.group_hikes
    WHERE (p_group_id IS NULL OR group_id = p_group_id)
      AND status IN ('SCHEDULED', 'IN_PROGRESS', 'EXPIRED')
  LOOP
    RETURN NEXT public.recompute_group_hike_status(v_hike_id);
  END LOOP;

  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_group_hike_recording(
  p_hike_id uuid,
  p_local_session_id text DEFAULT NULL
)
RETURNS public.group_hike_attendance
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_hike public.group_hikes%ROWTYPE;
  v_row public.group_hike_attendance%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Login required';
  END IF;

  SELECT * INTO v_hike FROM public.recompute_group_hike_status(p_hike_id);

  IF v_hike.status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Group hike is not in progress';
  END IF;

  INSERT INTO public.group_hike_attendance (
    hike_id,
    user_id,
    participation_status,
    local_session_id,
    started_at
  )
  VALUES (
    p_hike_id,
    v_user_id,
    'RECORDING',
    p_local_session_id,
    now()
  )
  ON CONFLICT (hike_id, user_id)
  DO UPDATE SET
    participation_status = CASE
      WHEN public.group_hike_attendance.participation_status = 'FINISHED' THEN 'FINISHED'
      ELSE 'RECORDING'
    END,
    local_session_id = COALESCE(EXCLUDED.local_session_id, public.group_hike_attendance.local_session_id),
    started_at = COALESCE(public.group_hike_attendance.started_at, now())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_group_hike_recording(
  p_hike_id uuid,
  p_local_session_id text DEFAULT NULL
)
RETURNS public.group_hikes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_hike public.group_hikes%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Login required';
  END IF;

  SELECT * INTO v_hike FROM public.recompute_group_hike_status(p_hike_id);

  IF v_hike.status IN ('SCHEDULED', 'CANCELLED', 'EXPIRED') THEN
    RAISE EXCEPTION 'Group hike cannot be finished in the current status';
  END IF;

  INSERT INTO public.group_hike_attendance (
    hike_id,
    user_id,
    participation_status,
    local_session_id,
    finished_at
  )
  VALUES (
    p_hike_id,
    v_user_id,
    'FINISHED',
    p_local_session_id,
    now()
  )
  ON CONFLICT (hike_id, user_id)
  DO UPDATE SET
    participation_status = 'FINISHED',
    local_session_id = COALESCE(EXCLUDED.local_session_id, public.group_hike_attendance.local_session_id),
    finished_at = COALESCE(public.group_hike_attendance.finished_at, now());

  SELECT * INTO v_hike FROM public.recompute_group_hike_status(p_hike_id);
  RETURN v_hike;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_group_hike(p_hike_id uuid)
RETURNS public.group_hikes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_hike public.group_hikes%ROWTYPE;
  v_old_status text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Login required';
  END IF;

  IF NOT public.can_manage_group_hike(p_hike_id, v_user_id) THEN
    RAISE EXCEPTION 'Only the group leader or hike creator can cancel this hike';
  END IF;

  SELECT * INTO v_hike
  FROM public.group_hikes
  WHERE id = p_hike_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group hike not found';
  END IF;

  v_old_status := v_hike.status;

  UPDATE public.group_hikes
  SET status = 'CANCELLED',
      updated_at = now()
  WHERE id = p_hike_id
  RETURNING * INTO v_hike;

  PERFORM public.log_group_hike_status_event(p_hike_id, v_old_status, 'CANCELLED', 'manual_cancel', v_user_id);
  RETURN v_hike;
END;
$$;

CREATE OR REPLACE FUNCTION public.manual_complete_group_hike(p_hike_id uuid)
RETURNS public.group_hikes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_hike public.group_hikes%ROWTYPE;
  v_old_status text;
  v_completed_count integer;
  v_start_time timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Login required';
  END IF;

  IF NOT public.can_manage_group_hike(p_hike_id, v_user_id) THEN
    RAISE EXCEPTION 'Only the group leader or hike creator can complete this hike';
  END IF;

  SELECT * INTO v_hike
  FROM public.group_hikes
  WHERE id = p_hike_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group hike not found';
  END IF;

  v_start_time := COALESCE(v_hike.start_time, v_hike.meeting_at);

  IF now() < v_start_time THEN
    RAISE EXCEPTION 'Cannot complete a group hike before its start time';
  END IF;

  IF v_hike.status IN ('CANCELLED', 'EXPIRED') THEN
    RAISE EXCEPTION 'Cannot complete a cancelled or expired group hike';
  END IF;

  SELECT COUNT(*)
  INTO v_completed_count
  FROM public.group_hike_attendance
  WHERE hike_id = p_hike_id
    AND participation_status = 'FINISHED';

  v_old_status := v_hike.status;

  UPDATE public.group_hikes
  SET status = 'COMPLETED',
      completed_member_count = v_completed_count,
      completed_at = COALESCE(completed_at, now()),
      manually_completed_at = COALESCE(manually_completed_at, now()),
      updated_at = now()
  WHERE id = p_hike_id
  RETURNING * INTO v_hike;

  PERFORM public.log_group_hike_status_event(
    p_hike_id,
    v_old_status,
    'COMPLETED',
    'manual_complete',
    v_user_id,
    jsonb_build_object('completed_member_count', v_completed_count)
  );

  RETURN v_hike;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_group_hike_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_group_hike_statuses(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_group_hike_recording(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_group_hike_recording(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_group_hike(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manual_complete_group_hike(uuid) TO authenticated;

-- Optional Supabase Scheduled Job body:
-- SELECT public.refresh_group_hike_statuses(NULL);

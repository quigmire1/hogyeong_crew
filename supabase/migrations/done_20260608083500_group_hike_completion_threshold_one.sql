-- Change group hike auto-completion from 2 finished members to 1.

INSERT INTO public.app_settings (key, value)
VALUES ('GROUP_HIKE_COMPLETION_THRESHOLD', '1'::jsonb)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

UPDATE public.group_hikes
SET completion_threshold = 1,
    updated_at = now()
WHERE completion_threshold = 2;

UPDATE public.group_hike_settings
SET completion_threshold = 1,
    updated_at = now()
WHERE completion_threshold = 2;

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
    public.app_setting_int('GROUP_HIKE_COMPLETION_THRESHOLD', 1)
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

SELECT public.refresh_group_hike_statuses(NULL);

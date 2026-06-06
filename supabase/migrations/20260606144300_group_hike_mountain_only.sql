-- Simplify group hike creation/editing around the mountain name.
-- `summary_text` is kept because it stores completed hike records, not the old free-form detail input.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'group_hikes'
      AND column_name = 'title'
  ) THEN
    UPDATE public.group_hikes
    SET mountain_name = COALESCE(NULLIF(mountain_name, ''), NULLIF(title, ''), '덩산')
    WHERE mountain_name IS NULL
       OR mountain_name = '';
  ELSE
    UPDATE public.group_hikes
    SET mountain_name = COALESCE(NULLIF(mountain_name, ''), '덩산')
    WHERE mountain_name IS NULL
       OR mountain_name = '';
  END IF;
END;
$$;

ALTER TABLE public.group_hikes
  ALTER COLUMN mountain_name SET NOT NULL;

ALTER TABLE public.group_hikes
  DROP COLUMN IF EXISTS title,
  DROP COLUMN IF EXISTS description;

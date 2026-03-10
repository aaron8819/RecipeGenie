-- RPC functions for bulk tag operations.
-- Replace the N-per-recipe loops in useRenameTag, useDeleteTag, useMergeTags
-- with a single UPDATE statement each, reducing HTTP requests from O(N) to O(1).

-- Rename a tag across all of a user's recipes
CREATE OR REPLACE FUNCTION rename_tag(p_user_id UUID, p_old_tag TEXT, p_new_tag TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE recipes
  SET tags = array_replace(tags, p_old_tag, p_new_tag)
  WHERE user_id = p_user_id
    AND p_old_tag = ANY(tags);
$$;

-- Remove a tag from all of a user's recipes
CREATE OR REPLACE FUNCTION delete_tag(p_user_id UUID, p_tag TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE recipes
  SET tags = array_remove(tags, p_tag)
  WHERE user_id = p_user_id
    AND p_tag = ANY(tags);
$$;

-- Rename a source tag to a target tag and deduplicate the resulting array.
-- Deduplication handles recipes that already carried both source and target.
CREATE OR REPLACE FUNCTION merge_tags(p_user_id UUID, p_source_tag TEXT, p_target_tag TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE recipes
  SET tags = ARRAY(
    SELECT DISTINCT unnest(array_replace(tags, p_source_tag, p_target_tag))
  )
  WHERE user_id = p_user_id
    AND p_source_tag = ANY(tags);
$$;

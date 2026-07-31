import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { recipeShareSnapshotForDisplay } from '@/lib/recipe-data-validation';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('recipe_shares')
    .select(
      'id, sender_user_id, sender_email, recipient_email, source_recipe_id:source_recipe_uuid, source_recipe_snapshot, message, status, accepted_recipe_id:accepted_recipe_uuid, created_at, responded_at'
    )
    .eq('sender_user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: 'Failed to load sent shares' },
      { status: 500 }
    );
  }

  const safeRows = (data || []).map((row) => ({
    ...row,
    source_recipe_snapshot: recipeShareSnapshotForDisplay(
      row.source_recipe_snapshot
    ),
  }));
  const response = NextResponse.json(safeRows);
  response.headers.set('Cache-Control', 'private, max-age=15');
  return response;
}

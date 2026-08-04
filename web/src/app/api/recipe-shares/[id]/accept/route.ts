import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { normalizeRecipeShareSnapshot } from '@/lib/recipe-data-validation';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rateCheck = await checkRateLimit(user.id, {
    maxRequests: 20,
    window: '1 m',
  });
  if (!rateCheck.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait and try again.' },
      { status: 429 }
    );
  }

  if (!id) {
    return NextResponse.json({ error: 'Share ID is required' }, { status: 400 });
  }

  const { data: share, error: shareError } = await supabase
    .from('recipe_shares')
    .select('source_recipe_snapshot, status')
    .eq('id', id)
    .eq('recipient_user_id', user.id)
    .maybeSingle();
  if (shareError || !share) {
    return NextResponse.json(
      { error: 'Unable to accept this share' },
      { status: 400 }
    );
  }
  if (
    !normalizeRecipeShareSnapshot(share.source_recipe_snapshot, 'persist')
  ) {
    return NextResponse.json(
      { error: 'Shared recipe data is invalid' },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc('accept_recipe_share', {
    p_share_id: id,
  });

  if (error) {
    const message = error.message || '';
    const status =
      message.includes('not found') || message.includes('pending') ? 400 : 500;
    return NextResponse.json(
      { error: 'Unable to accept this share' },
      { status }
    );
  }

  return NextResponse.json({
    acceptedRecipeId: data,
  });
}

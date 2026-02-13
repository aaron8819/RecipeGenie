import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

  if (!id) {
    return NextResponse.json({ error: 'Share ID is required' }, { status: 400 });
  }

  // @ts-expect-error - Supabase RPC arg inference can incorrectly require undefined.
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

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

  const { data: currentShare, error: fetchError } = await supabase
    .from('recipe_shares')
    .select('id, status')
    .eq('id', id)
    .eq('recipient_user_id', user.id)
    .maybeSingle();

  const typedShare = currentShare as
    | { id: string; status: 'pending' | 'accepted' | 'declined' | 'canceled' }
    | null;

  if (fetchError || !typedShare) {
    return NextResponse.json({ error: 'Share not found' }, { status: 404 });
  }

  if (typedShare.status === 'declined') {
    return NextResponse.json({ status: 'declined', id });
  }

  if (typedShare.status !== 'pending') {
    return NextResponse.json(
      { error: 'Only pending shares can be declined' },
      { status: 400 }
    );
  }

  const { error: updateError } = await supabase
    .from('recipe_shares')
    // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
    .update({
      status: 'declined',
      responded_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('recipient_user_id', user.id)
    .eq('status', 'pending');

  if (updateError) {
    return NextResponse.json(
      { error: 'Unable to decline this share' },
      { status: 500 }
    );
  }

  return NextResponse.json({ status: 'declined', id });
}

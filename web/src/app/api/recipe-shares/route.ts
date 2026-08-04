import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildRecipeShareSnapshot } from '@/lib/recipe-sharing';
import { checkRateLimit } from '@/lib/rate-limit';
import type { Recipe } from '@/types/database';
import { assertRecipeUuid, mapRecipeRow, type RecipeRow } from '@/lib/recipe-identity';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MESSAGE_LIMIT = 300;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function resolveRecipientUserByEmail(recipientEmail: string) {
  const admin = createAdminClient();
  const targetEmail = normalizeEmail(recipientEmail);
  let page = 1;

  // Supabase Auth Admin API has no direct "get user by email", so scan pages.
  while (page <= 10) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) {
      throw new Error('Unable to resolve recipient');
    }

    const users = data.users || [];
    const matched = users.find(
      (u) => normalizeEmail(u.email || '') === targetEmail
    );

    if (matched?.id) {
      return {
        id: matched.id,
        email: matched.email || null,
      };
    }

    if (users.length < 200) {
      break;
    }

    page += 1;
  }

  return null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rateCheck = await checkRateLimit(user.id);
  if (!rateCheck.success) {
    return NextResponse.json(
      {
        error: 'Too many share attempts. Please wait and try again.',
        reset: rateCheck.reset,
      },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': rateCheck.limit.toString(),
          'X-RateLimit-Remaining': rateCheck.remaining.toString(),
          'X-RateLimit-Reset': rateCheck.reset.toString(),
        },
      }
    );
  }

  let body: {
    recipeId?: string;
    recipientEmail?: string;
    message?: string | null;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const recipeId = body.recipeId?.trim();
  const recipientEmail = normalizeEmail(body.recipientEmail || '');
  const message = body.message?.trim() || null;

  if (!recipeId) {
    return NextResponse.json({ error: 'Recipe ID is required' }, { status: 400 });
  }
  try {
    assertRecipeUuid(recipeId);
  } catch {
    return NextResponse.json({ error: 'Recipe ID must be a UUID' }, { status: 400 });
  }

  if (!EMAIL_REGEX.test(recipientEmail)) {
    return NextResponse.json(
      { error: 'Please enter a valid recipient email address' },
      { status: 400 }
    );
  }

  if (message && message.length > MESSAGE_LIMIT) {
    return NextResponse.json(
      { error: `Message must be ${MESSAGE_LIMIT} characters or less` },
      { status: 400 }
    );
  }

  if (recipientEmail === normalizeEmail(user.email || '')) {
    return NextResponse.json(
      { error: 'You cannot share a recipe with yourself' },
      { status: 400 }
    );
  }

  const { data: sourceRecipe, error: recipeError } = await supabase
    .from('recipes')
    .select(
      'id,recipe_uuid,user_id,name,category,servings,yield_metadata,favorite,tags,ingredient_sections,instruction_sections,notes,image_url,prep_time_minutes,cook_time_minutes,total_time_minutes,created_at,updated_at'
    )
    .eq('recipe_uuid', recipeId)
    .eq('user_id', user.id)
    .single();

  if (recipeError || !sourceRecipe) {
    return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
  }

  const typedSourceRecipe = mapRecipeRow(sourceRecipe as RecipeRow);

  let recipientUser:
    | {
        id: string;
        email: string | null;
      }
    | null = null;

  try {
    recipientUser = await resolveRecipientUserByEmail(recipientEmail);
  } catch {
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 }
    );
  }

  if (!recipientUser?.id) {
    return NextResponse.json(
      { error: 'Recipient not found or unavailable' },
      { status: 400 }
    );
  }

  const { data: existingPending } = await supabase
    .from('recipe_shares')
    .select('id')
    .eq('sender_user_id', user.id)
    .eq('recipient_user_id', recipientUser.id)
    .eq('source_recipe_uuid', recipeId)
    .eq('status', 'pending')
    .maybeSingle();

  const typedExistingPending = existingPending as { id: string } | null;

  if (typedExistingPending?.id) {
    return NextResponse.json({
      id: typedExistingPending.id,
      status: 'pending',
      deduplicated: true,
    });
  }

  const shareInsert = supabase.from('recipe_shares') as unknown as {
    insert: (values: Record<string, unknown>) => {
      select: (columns: string) => {
        single: () => Promise<{ data: { id: string; status: string } | null; error: { message: string } | null }>
      }
    }
  };
  const { data: inserted, error: insertError } = await shareInsert
    .insert({
      sender_user_id: user.id,
      sender_email: normalizeEmail(user.email || ''),
      recipient_user_id: recipientUser.id,
      recipient_email: recipientEmail,
      source_recipe_uuid: typedSourceRecipe.id,
      source_recipe_snapshot: buildRecipeShareSnapshot(typedSourceRecipe),
      message,
      status: 'pending',
    })
    .select('id, status')
    .single();

  if (insertError || !inserted) {
    return NextResponse.json(
      { error: 'Unable to create recipe share' },
      { status: 500 }
    );
  }

  return NextResponse.json(inserted);
}

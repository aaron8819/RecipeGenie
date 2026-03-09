import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { extractRecipeFromHtml } from '@/lib/recipe-url-parser';
import { fetchRecipeHtmlSafely, UnsafeUrlError } from '@/lib/url-safety';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT =
  'RecipeGenie/1.0 (recipe importer; +https://recipegenie.app)';

export async function POST(request: Request) {
  // Authenticate
  const supabase = await createClient();
  const { data: { user }, error: authError } =
    await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Rate limit: 5 requests per minute (URL parsing is expensive)
  const rateCheck = await checkRateLimit(user.id, {
    maxRequests: 5,
    window: '1 m',
  });
  if (!rateCheck.success) {
    return NextResponse.json(
      { error: 'Too many import attempts. Please wait and try again.' },
      { status: 429 }
    );
  }

  // Parse request body
  let url: string;
  try {
    const body = await request.json();
    url = body.url;
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }

  // Validate URL
  if (!url || typeof url !== 'string') {
    return NextResponse.json(
      { error: 'URL is required' },
      { status: 400 }
    );
  }

  try {
    const html = await fetchRecipeHtmlSafely(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      userAgent: USER_AGENT,
      maxRedirects: 5,
      maxBytes: 2_000_000,
    });

    // Extract recipe from HTML
    const recipe = extractRecipeFromHtml(html);

    return NextResponse.json(recipe);
  } catch (err) {
    if (err instanceof UnsafeUrlError) {
      return NextResponse.json(
        { error: err.message },
        { status: 400 }
      );
    }

    const message = err instanceof Error
      ? err.message
      : 'Unknown error';
    if (message.includes('abort')) {
      return NextResponse.json(
        { error: 'Request timed out' },
        { status: 408 }
      );
    }
    return NextResponse.json(
      { error: `Failed to fetch page: ${message}` },
      { status: 422 }
    );
  }
}

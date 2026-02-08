import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { extractRecipeFromHtml } from '@/lib/recipe-url-parser';

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
    new URL(url);
  } catch {
    return NextResponse.json(
      { error: 'Invalid URL format' },
      { status: 400 }
    );
  }

  // Fetch the page
  let html: string;
  try {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      FETCH_TIMEOUT_MS
    );

    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timer);

    if (!res.ok) {
      return NextResponse.json(
        {
          error: `Failed to fetch page (${res.status})`,
        },
        { status: 422 }
      );
    }

    html = await res.text();
  } catch (err) {
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

  // Extract recipe from HTML
  const recipe = extractRecipeFromHtml(html);

  return NextResponse.json(recipe);
}

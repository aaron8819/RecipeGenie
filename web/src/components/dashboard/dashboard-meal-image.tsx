'use client';

import { useState } from 'react';
import Image from 'next/image';
import { UtensilsCrossed } from 'lucide-react';

export function DashboardMealImage({ src }: { src: string | null }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return <UtensilsCrossed className="h-7 w-7" aria-hidden />;
  // Match the existing Recipe/Planner direct-image policy. Only configured
  // HTTPS Supabase hosts go through the optimizer; no allowlist/CSP expansion.
  let optimized = false;
  try {
    const url = new URL(src);
    optimized = url.protocol === 'https:' && url.hostname.endsWith('.supabase.co');
  } catch { /* Relative URLs use direct same-origin loading. */ }
  return <Image src={src} alt="" width={500} height={330}
    unoptimized={!optimized} onError={() => setFailedSrc(src)} />;
}

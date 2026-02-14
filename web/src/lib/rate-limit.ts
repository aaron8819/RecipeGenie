import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = Redis.fromEnv();
  }
  return redis;
}

const limiters = new Map<string, Ratelimit>();

function getLimiter(maxRequests: number, window: string): Ratelimit {
  const key = `${maxRequests}:${window}`;
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(maxRequests, window as `${number} ${'s' | 'ms' | 'm' | 'h' | 'd'}`),
      analytics: true,
      prefix: '@recipe-genie/ratelimit',
    });
    limiters.set(key, limiter);
  }
  return limiter;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

export async function checkRateLimit(
  identifier: string,
  options?: { maxRequests?: number; window?: string }
): Promise<RateLimitResult> {
  const maxRequests = options?.maxRequests ?? 10;
  const window = options?.window ?? '1 m';

  // Graceful degradation if KV not configured
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Rate limiting not configured');
    }
    console.warn('KV not configured, skipping rate limit check');
    return { success: true, limit: 0, remaining: 0, reset: 0 };
  }

  try {
    const limiter = getLimiter(maxRequests, window);
    const result = await limiter.limit(identifier);
    return result;
  } catch (error) {
    console.error('Rate limit check failed:', error);
    // Fail closed in production, fail open in dev
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }
    return { success: true, limit: 0, remaining: 0, reset: 0 };
  }
}

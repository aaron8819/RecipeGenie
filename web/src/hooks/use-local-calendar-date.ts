'use client';

import { useEffect, useState } from 'react';
import { formatLocalISODate } from '@/components/planner/meal-planner.utils';

export function useLocalCalendarDate() {
  // Server and browser timezones can disagree; initialize after hydration.
  const [date, setDate] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function update() {
      clearTimeout(timer);
      const now = new Date();
      setDate(formatLocalISODate(now));
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      timer = setTimeout(update, midnight.getTime() - now.getTime() + 50);
    }
    update();
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return date;
}

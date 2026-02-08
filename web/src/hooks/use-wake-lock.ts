'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Custom hook wrapping the Screen Wake Lock API.
 * Automatically requests on mount and releases on unmount.
 * Gracefully degrades if unsupported.
 */
export function useWakeLock() {
  const [isActive, setIsActive] = useState(false);
  const sentinelRef = useRef<WakeLockSentinel | null>(
    null
  );

  const isSupported =
    typeof navigator !== 'undefined' &&
    'wakeLock' in navigator;

  const request = useCallback(async () => {
    if (!isSupported) return;
    try {
      const sentinel =
        await navigator.wakeLock.request('screen');
      sentinelRef.current = sentinel;
      setIsActive(true);

      sentinel.addEventListener('release', () => {
        sentinelRef.current = null;
        setIsActive(false);
      });
    } catch {
      // Wake lock request failed (e.g., low battery)
      setIsActive(false);
    }
  }, [isSupported]);

  const release = useCallback(async () => {
    if (sentinelRef.current) {
      await sentinelRef.current.release();
      sentinelRef.current = null;
      setIsActive(false);
    }
  }, []);

  // Re-acquire when tab regains visibility
  useEffect(() => {
    if (!isSupported) return;

    const handleVisibility = () => {
      if (
        document.visibilityState === 'visible' &&
        !sentinelRef.current
      ) {
        request();
      }
    };

    document.addEventListener(
      'visibilitychange',
      handleVisibility
    );
    return () => {
      document.removeEventListener(
        'visibilitychange',
        handleVisibility
      );
    };
  }, [isSupported, request]);

  return { isSupported, isActive, request, release };
}

// Streamed loading shell shown by Next.js while the root layout's async work
// (headers/nonce setup) is in-flight. Matches the app chrome so there is no
// colour flash or layout shift when the real content arrives.
export default function Loading() {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header placeholder */}
      <div
        className="fixed top-0 left-0 right-0 z-10 bg-muted animate-pulse border-b border-border"
        style={{ height: 'var(--header-height, 65px)' }}
      />

      {/* Content skeleton */}
      <div
        className="flex-1 px-4 space-y-3 animate-pulse"
        style={{
          paddingTop: 'calc(var(--header-height, 65px) + 1rem)',
          paddingBottom: 'calc(var(--bottom-nav-safe-height, 64px) + 1rem)',
        }}
      >
        <div className="mt-2 h-7 w-40 rounded-lg bg-muted" />
        <div className="h-20 rounded-xl bg-muted" />
        <div className="h-20 rounded-xl bg-muted" />
        <div className="h-20 rounded-xl bg-muted opacity-70" />
        <div className="h-20 rounded-xl bg-muted opacity-40" />
      </div>

      {/* Bottom nav placeholder */}
      <div
        className="fixed bottom-0 left-0 right-0 bg-muted animate-pulse border-t border-border"
        style={{ height: 'var(--bottom-nav-safe-height, 64px)' }}
      />
    </div>
  )
}

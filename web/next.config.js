/** @type {import('next').NextConfig} */
const packageJson = require('./package.json')

const nextConfig = {
  // Strict mode for better development experience
  reactStrictMode: true,

  // Keep local browser-inspection screenshots and mobile navigation free of
  // the development portal that otherwise overlaps the bottom-left tab.
  devIndicators:
    process.env.RECIPE_GENIE_E2E_TARGET === 'local' ? false : undefined,

  // Explicitly set project root to avoid workspace detection issues
  outputFileTracingRoot: require('path').join(__dirname, '../'),

  // Freeze public deployment metadata into the build. Vercel supplies
  // VERCEL_GIT_COMMIT_SHA; operators may override either value explicitly.
  env: {
    RECIPE_GENIE_GIT_SHA:
      process.env.RECIPE_GENIE_GIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || '',
    RECIPE_GENIE_BUILD_TIMESTAMP:
      process.env.RECIPE_GENIE_BUILD_TIMESTAMP || new Date().toISOString(),
    RECIPE_GENIE_APP_VERSION: packageJson.version,
  },

  images: {
    // Preserve Next 15's revalidation floor for replace-in-place recipe images.
    minimumCacheTTL: 60,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
}

module.exports = nextConfig

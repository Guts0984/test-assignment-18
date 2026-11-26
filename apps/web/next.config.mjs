const apiUrl = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3000';

/** @type {import('next').NextConfig} */
const config = {
  output: 'standalone',
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  poweredByHeader: false,
  // Linting runs once for the whole workspace.
  eslint: { ignoreDuringBuilds: true },
  // Behind nginx these paths never reach Next; they serve local development.
  rewrites: () => Promise.resolve([{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }]),
};

export default config;

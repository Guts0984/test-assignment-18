import { z } from 'zod';

/** Server-only variables, checked when the server is built or started. Never sent to browsers. */
const { API_INTERNAL_URL: apiUrl } = z
  .object({ API_INTERNAL_URL: z.url().default('http://127.0.0.1:3000') })
  .parse(process.env);

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

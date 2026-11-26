import { z } from 'zod';

/** Values inlined into the browser bundle. Next replaces each literal reference at build time. */
const publicSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.string().min(1).default('/api'),
  NEXT_PUBLIC_SOCKET_PATH: z.string().startsWith('/').default('/socket.io'),
});

export const env = Object.freeze(
  publicSchema.parse({
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
    NEXT_PUBLIC_SOCKET_PATH: process.env.NEXT_PUBLIC_SOCKET_PATH,
  }),
);

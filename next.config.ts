import type { NextConfig } from 'next';

const config: NextConfig = {
  // The generated Prisma client and the pg driver stay on the server.
  serverExternalPackages: ['@prisma/client', 'pg'],
  // Portal uploads: src/content/pipeline.ts MAX_UPLOAD_BYTES (25 MB) is the real
  // ceiling; this leaves room for multipart overhead so that check is what refuses.
  experimental: { serverActions: { bodySizeLimit: '26mb' } },
  // Portal pages carry their credential in the path (SEC-05): never cached,
  // never sent on as a Referer, never indexed.
  async headers() {
    return [{
      source: '/portal/:path*',
      headers: [
        { key: 'Cache-Control', value: 'no-store' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      ],
    }];
  },
};

export default config;

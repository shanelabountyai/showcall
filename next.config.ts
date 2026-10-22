import type { NextConfig } from 'next';

const config: NextConfig = {
  // The generated Prisma client and the pg driver stay on the server.
  serverExternalPackages: ['@prisma/client', 'pg'],
  // Portal uploads: src/content/pipeline.ts MAX_UPLOAD_BYTES (25 MB) is the real
  // ceiling; this leaves room for multipart overhead so that check is what refuses.
  experimental: { serverActions: { bodySizeLimit: '26mb' } },
  // Every response (SEC-06): never framed, never sniffed, HTTPS only once seen
  // over HTTPS, and only the origin goes out as a Referer. Then portal pages,
  // which carry their credential in the path (SEC-05): never cached, never sent
  // on as a Referer, never indexed. Order matters: a later entry's value wins
  // for a key both set, so the portal's Referrer-Policy overrides this one.
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
      ],
    }, {
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

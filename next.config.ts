import type { NextConfig } from 'next';

const config: NextConfig = {
  // The generated Prisma client and the pg driver stay on the server.
  serverExternalPackages: ['@prisma/client', 'pg'],
  // Portal uploads: src/content/pipeline.ts MAX_UPLOAD_BYTES (25 MB) is the real
  // ceiling; this leaves room for multipart overhead so that check is what refuses.
  experimental: { serverActions: { bodySizeLimit: '26mb' } },
};

export default config;

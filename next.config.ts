import type { NextConfig } from 'next';

const config: NextConfig = {
  // The generated Prisma client and the pg driver stay on the server.
  serverExternalPackages: ['@prisma/client', 'pg'],
};

export default config;

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

// Same guard as prisma.config.ts: reaching a cloud database has to be typed.
if (!process.env.SHOWCALL_ALLOW_CLOUD_DB && /neon\.tech|rds\.amazonaws|supabase\.co/.test(connectionString)) {
  throw new Error('Showcall runs on local Postgres. Refusing a cloud database.');
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

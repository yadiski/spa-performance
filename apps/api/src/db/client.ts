import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadEnv } from '../env';
import * as schema from './schema';

const env = loadEnv();
const client = postgres(env.DATABASE_URL, { max: 10 });
export const db = drizzle(client, { schema });
export type DB = typeof db;

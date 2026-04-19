import PgBoss from 'pg-boss';
import { loadEnv } from '../env';

const env = loadEnv();
export const boss = new PgBoss({ connectionString: env.DATABASE_URL });

export async function startBoss() {
  await boss.start();
}

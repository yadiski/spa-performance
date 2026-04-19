import { loadEnv } from './env';
import { app } from './http/app';

const env = loadEnv();
// Railway injects PORT; prefer it so we match whatever the edge router expects.
const port = Number(process.env.PORT) || env.API_PORT;
console.log(`api listening on 0.0.0.0:${port}`);
export default { port, hostname: '0.0.0.0', fetch: app.fetch };

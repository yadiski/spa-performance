import { app } from './http/app';
import { loadEnv } from './env';

const env = loadEnv();
const port = env.API_PORT;
console.log(`api listening on http://localhost:${port}`);
export default { port, fetch: app.fetch };

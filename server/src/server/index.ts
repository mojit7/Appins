import { loadEnv } from '../config/env.js';
import { createDbPool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import { buildApp } from './app.js';

const env = loadEnv();
const pool = createDbPool(env.DATABASE_URL);
const app = buildApp({ env, instagram: { env, pool }, ai: { env, pool } });

runMigrations(pool)
  .then(() => app.listen({ port: env.PORT, host: '0.0.0.0' }))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

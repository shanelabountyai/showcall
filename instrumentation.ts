/** Runs once when a server starts, before it takes a request: a malformed environment stops it here (K11). */
export async function register() {
  const { parseEnv } = await import('./src/env');
  parseEnv(process.env);
}

/**
 * Environment access with fail-fast validation (server only).
 * Public vars are read directly via process.env.NEXT_PUBLIC_* so Next.js can
 * inline them; this helper covers server-side secrets.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`,
    );
  }
  return value;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const canonical_url = requireEnv("CONCRETE_CANONICAL_URL");
export const client_id = requireEnv("CONCRETE_API_CLIENT_ID");
export const client_secret = requireEnv("CONCRETE_API_CLIENT_SECRET");
export const scope = requireEnv("CONCRETE_API_SCOPE");

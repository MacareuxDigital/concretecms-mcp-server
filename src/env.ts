export const canonical_url = process.env.CONCRETE_CANONICAL_URL;
export const client_id = process.env.CONCRETE_API_CLIENT_ID;
export const client_secret = process.env.CONCRETE_API_CLIENT_SECRET;
export const scope = process.env.CONCRETE_API_SCOPE;

if (!canonical_url || !client_id || !client_secret || !scope) {
  throw new Error("Missing environment variables");
}

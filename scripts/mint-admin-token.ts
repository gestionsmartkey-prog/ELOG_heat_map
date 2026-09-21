/**
 * Mint an admin bearer token for POST /api/users.
 *   SESSION_SECRET=... npx tsx scripts/mint-admin-token.ts [ttlSeconds] [note]
 * Then: curl -X POST https://elog-heat-map.vercel.app/api/users \
 *         -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
 *         -d '{"email":"persona@empresa.com","password":"unaClaveLarga","role":"viewer"}'
 */
import { createAdminToken } from "../src/lib/auth";

async function main() {
  const ttl = Number(process.argv[2] ?? 3600);
  const note = process.argv[3] ?? "admin";
  if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET must be set to the same value as production");
  const token = await createAdminToken(ttl, note);
  console.log(token);
  console.error(`# admin token, expires in ${ttl}s`);
}
main().catch((e) => { console.error(e); process.exit(1); });

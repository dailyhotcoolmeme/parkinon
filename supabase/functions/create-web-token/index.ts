import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const WEB_BASE = Deno.env.get("WEB_BASE_URL") ?? "https://parkinon.com";
const TTL_MINUTES = 10; // 6-digit PC-login code lives 10 minutes
const RATE_LIMIT_PER_MINUTE = 30;
const MAX_CODE_GEN_TRIES = 12;

function genCode(): string {
  // 6-digit numeric, zero-padded (100000..999999 incl. leading-zero codes)
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return (n[0] % 1_000_000).toString().padStart(6, "0");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace("Bearer ", "");
  if (!jwt) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return new Response(JSON.stringify({ error: "invalid session" }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const userId = userData.user.id;

  const admin = createClient(supabaseUrl, serviceKey);

  // rate limit: N issuances per user per minute
  const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin.from("web_login_tokens").select("token", { count: "exact", head: true })
    .eq("user_id", userId).gte("created_at", oneMinAgo);
  if ((count ?? 0) >= RATE_LIMIT_PER_MINUTE) return new Response(JSON.stringify({ error: "rate limit exceeded, please retry shortly" }), { status: 429, headers: { 'Content-Type': 'application/json' } });

  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000).toISOString();
  const nowIso = new Date().toISOString();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = req.headers.get("user-agent") ?? null;

  // Generate a 6-digit code that does not collide with any ACTIVE (unused & unexpired) code.
  // `token` is the PK, so a stale (used/expired) row holding the same code must be cleared first
  // before we can reuse that code — codes are reusable once the old one is dead.
  let code: string | null = null;
  let lastErr: string | null = null;
  for (let i = 0; i < MAX_CODE_GEN_TRIES; i++) {
    const candidate = genCode();

    const { data: existing } = await admin.from("web_login_tokens")
      .select("token, used_at, expires_at").eq("token", candidate).maybeSingle();

    if (existing) {
      const active = !existing.used_at && new Date(existing.expires_at) > new Date();
      if (active) continue; // collides with a live code -> pick another
      // stale row: drop it so the PK frees up for reuse
      await admin.from("web_login_tokens").delete().eq("token", candidate);
    }

    const { error: insErr } = await admin.from("web_login_tokens").insert({
      token: candidate, user_id: userId, expires_at: expiresAt, ip_address: ip, user_agent: ua,
    });
    if (!insErr) { code = candidate; break; }
    // unique violation (race with concurrent issuer) -> retry with a new code
    lastErr = insErr.message;
  }

  if (!code) return new Response(JSON.stringify({ error: lastErr ?? "code generation failed" }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  // Best-effort cleanup of clearly stale rows to keep the code space free (non-blocking semantics).
  await admin.from("web_login_tokens").delete().lt("expires_at", new Date(Date.now() - 60_000).toISOString());

  // url path == the 6-digit code, so "웹에서 보기"/"추세보기" auto-open via /r/{code} still works.
  return new Response(JSON.stringify({ code, url: `${WEB_BASE}/r/${code}`, expires_at: expiresAt }), {
    headers: { "Content-Type": "application/json" },
  });
});

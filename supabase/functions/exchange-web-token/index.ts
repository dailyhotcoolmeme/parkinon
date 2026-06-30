import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "https://parkinon.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const JSON_HEADERS = { ...CORS, "Content-Type": "application/json" };

const WINDOW_MS = 5 * 60_000; // 5-minute brute-force window
const MAX_FAILS = 5;          // >= 5 fails in window -> locked

function jsonErr(error: string, status: number) {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: CORS });

  let body: { code?: string; token?: string } = {};
  try { body = await req.json(); } catch { /* */ }
  // accept new { code } and legacy { token }
  const code = (body.code ?? body.token)?.trim();

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  // ---- IP brute-force gate (check BEFORE doing any work) ----
  const nowMs = Date.now();
  const { data: att } = await admin.from("web_login_attempts")
    .select("ip, fail_count, window_start").eq("ip", ip).maybeSingle();

  let failCount = 0;
  let windowStartMs = nowMs;
  if (att) {
    const ws = new Date(att.window_start).getTime();
    if (nowMs - ws < WINDOW_MS) {
      failCount = att.fail_count;
      windowStartMs = ws;
    } // else: window expired -> reset to 0 below on next write
  }

  if (failCount >= MAX_FAILS) {
    // already locked for this window
    return jsonErr("locked", 423);
  }

  // record a failure (resets window if it had expired)
  const recordFail = async () => {
    const expired = nowMs - windowStartMs >= WINDOW_MS;
    const newCount = expired ? 1 : failCount + 1;
    const newWindow = expired ? new Date(nowMs).toISOString() : new Date(windowStartMs).toISOString();
    await admin.from("web_login_attempts").upsert({
      ip, fail_count: newCount, window_start: newWindow, updated_at: new Date(nowMs).toISOString(),
    }, { onConflict: "ip" });
    return newCount;
  };

  if (!code || !/^\d{6}$/.test(code)) {
    const c = await recordFail();
    return jsonErr(c >= MAX_FAILS ? "locked" : "invalid", c >= MAX_FAILS ? 423 : 404);
  }

  // ---- lookup code ----
  const { data: row } = await admin.from("web_login_tokens")
    .select("token, user_id, expires_at, used_at").eq("token", code).maybeSingle();

  if (!row) {
    const c = await recordFail();
    return jsonErr(c >= MAX_FAILS ? "locked" : "invalid", c >= MAX_FAILS ? 423 : 404);
  }
  if (row.used_at) {
    return jsonErr("used", 410); // a real (already-issued) code -> not a brute-force signal
  }
  if (new Date(row.expires_at) < new Date()) {
    return jsonErr("expired", 410);
  }

  // ---- race-safe claim ----
  const { data: claimed } = await admin.from("web_login_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token", code).is("used_at", null).select("token").maybeSingle();
  if (!claimed) return jsonErr("used", 410);

  // success -> clear this IP's failure counter
  await admin.from("web_login_attempts").delete().eq("ip", ip);

  // ---- materialize session via magiclink ----
  const { data: userResp, error: uerr } = await admin.auth.admin.getUserById(row.user_id);
  if (uerr || !userResp.user?.email) return jsonErr("user not found", 500);
  const email = userResp.user.email;

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr || !link?.properties?.hashed_token) {
    return jsonErr(linkErr?.message ?? "link failed", 500);
  }

  const { data: verified, error: vErr } = await admin.auth.verifyOtp({
    token_hash: link.properties.hashed_token, type: "magiclink",
  });
  if (vErr || !verified.session) {
    return jsonErr(vErr?.message ?? "verify failed", 500);
  }

  return new Response(JSON.stringify({
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
    user_id: row.user_id,
  }), { headers: JSON_HEADERS });
});

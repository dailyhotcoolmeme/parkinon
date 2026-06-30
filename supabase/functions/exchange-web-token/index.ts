import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "https://parkinon.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const JSON_HEADERS = { ...CORS, "Content-Type": "application/json" };

const WINDOW_MS = 5 * 60_000; // 5-minute brute-force window
const MAX_FAILS = 5;          // >= 5 fails in window (per IP) -> locked
const MAX_CODE_FAILS = 5;     // >= 5 fails on the SAME submitted code -> that code locked
const MAX_GLOBAL_FAILS = 100; // >= 100 fails across ALL requests in window -> global lockout (backstop)
const GLOBAL_KEY = "__global__";

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
  const nowMs = Date.now();

  // ---- 다중 카운터 게이트 ----
  // web_login_attempts 테이블의 ip 컬럼을 키 네임스페이스로 재사용한다(스키마 변경 불필요):
  //   - ip 그대로            → per-IP 카운터(기존)
  //   - "__global__"         → 전역 카운터(XFF 스푸핑에 독립적인 백스톱)
  //   - "code:<6자리>"       → 제출된 코드별 카운터(특정 코드 표적 무차별 대입 차단)
  // 6자리 공간(10^6) + 5분 TTL + 위 3중 제한으로 무차별 대입은 사실상 불가.
  const readCounter = async (key: string): Promise<{ failCount: number; windowStartMs: number }> => {
    const { data } = await admin.from("web_login_attempts")
      .select("fail_count, window_start").eq("ip", key).maybeSingle();
    if (data) {
      const ws = new Date(data.window_start).getTime();
      if (nowMs - ws < WINDOW_MS) return { failCount: data.fail_count, windowStartMs: ws };
    }
    return { failCount: 0, windowStartMs: nowMs }; // 없거나 윈도우 만료 → 0부터
  };

  const bumpCounter = async (key: string, cur: { failCount: number; windowStartMs: number }): Promise<number> => {
    const expired = nowMs - cur.windowStartMs >= WINDOW_MS;
    const newCount = expired ? 1 : cur.failCount + 1;
    const newWindow = expired ? nowMs : cur.windowStartMs;
    await admin.from("web_login_attempts").upsert({
      ip: key, fail_count: newCount, window_start: new Date(newWindow).toISOString(),
      updated_at: new Date(nowMs).toISOString(),
    }, { onConflict: "ip" });
    return newCount;
  };

  // 작업 시작 전 IP·전역 게이트 확인
  const ipCur = await readCounter(ip);
  const globalCur = await readCounter(GLOBAL_KEY);
  if (ipCur.failCount >= MAX_FAILS) return jsonErr("locked", 423);
  if (globalCur.failCount >= MAX_GLOBAL_FAILS) return jsonErr("locked", 423);

  // 실패 1건 기록: IP·전역(+유효 6자리 코드면 코드별)을 함께 증가. locked 여부 반환.
  const recordFail = async (codeKey?: string): Promise<boolean> => {
    const ipC = await bumpCounter(ip, ipCur);
    const gC = await bumpCounter(GLOBAL_KEY, globalCur);
    let cC = 0;
    if (codeKey) cC = await bumpCounter(`code:${codeKey}`, await readCounter(`code:${codeKey}`));
    return ipC >= MAX_FAILS || gC >= MAX_GLOBAL_FAILS || cC >= MAX_CODE_FAILS;
  };

  if (!code || !/^\d{6}$/.test(code)) {
    const locked = await recordFail();
    return jsonErr(locked ? "locked" : "invalid", locked ? 423 : 404);
  }

  // 코드별 게이트: 이 코드에 누적 실패가 임계 이상이면 무차별 대입으로 보고 잠금
  const codeCur = await readCounter(`code:${code}`);
  if (codeCur.failCount >= MAX_CODE_FAILS) return jsonErr("locked", 423);

  // ---- lookup code ----
  const { data: row } = await admin.from("web_login_tokens")
    .select("token, user_id, expires_at, used_at").eq("token", code).maybeSingle();

  if (!row) {
    const locked = await recordFail(code);
    return jsonErr(locked ? "locked" : "invalid", locked ? 423 : 404);
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

  // success -> clear this IP's and this code's failure counters (전역은 윈도우 만료로 자연 감소)
  await admin.from("web_login_attempts").delete().in("ip", [ip, `code:${code}`]);

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

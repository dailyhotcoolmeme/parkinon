// 가족 일기 작성 → 그룹의 다른 가족(환자+보호자) 푸시 (cross-user)
//
// 입력(JSON body):
//   - patient_id: string (필수) — 일기가 속한 환자(그룹 기준)
//   - entry_date: string (필수) — 일기 날짜(YYYY-MM-DD). 알림 탭 시 그 날짜 일기로 진입.
//   - author_id:  string (필수) — 작성자
//
// 동작:
//   1) 호출자(JWT)가 author 본인인지 검증(타인 위조 방지)
//   2) 환자(patient_id)의 patient_group_id + 작성자 이름 조회
//   3) 수신자 = 그룹의 [환자] + [보호자 전원] − [작성자]
//   4) 각 수신자의 diary_notif_enabled(기본 true) + notification_enabled + push_token 확인 후 발송
//   5) notification_logs 저장(미읽음). 문구: "OO님이 가족 일기를 남겼어요"(내용 미리보기 없음)
//
// ⚠️ cross-user 는 서버 푸시 필수(CLAUDE.md). 수정 시엔 클라가 호출 안 함(새 작성만).
// payload data: { type: 'family_diary', date, patient_id }  → App.tsx 가 Diary { date } 로 라우팅

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

interface ReqBody {
  patient_id?: string;
  entry_date?: string;
  author_id?: string;
}

/** Android channelId(`parkinon_alarm_<soundId>`) → 그 soundId 만 추출(없으면 null). */
function soundIdFromChannel(channelId: string): string | null {
  if (channelId === 'default') return null;
  const m = channelId.match(/^parkinon_alarm_(.+)$/);
  return m ? m[1] : null;
}

/** soundId → iOS 알림음 파일명(클라 alarmSoundFileNameIOS 와 동일 규칙). */
function alarmSoundFileNameIOS(soundId: string): string {
  return `parkinon_${soundId}.caf`;
}

/** 프리셋 채널(`parkinon_preset_<fileId>`) → fileId (아니면 null). */
function presetFileIdFromChannel(channelId: string): string | null {
  const m = channelId.match(/^parkinon_preset_(.+)$/);
  return m ? m[1] : null;
}

/**
 * 저장된 알림음 id → Android channelId (send-medication-reminders 와 동일 규칙).
 * - 'preset:<fileId>' → 번들 프리셋 채널 `parkinon_preset_<fileId>`
 * - 녹음 uuid → `parkinon_alarm_<uuid>`
 * - null(시스템 기본음) → 'default'
 */
function channelForStoredSound(soundId: string | null | undefined): string {
  if (!soundId) return 'default';
  if (soundId.startsWith('preset:')) return `parkinon_preset_${soundId.slice('preset:'.length)}`;
  return `parkinon_alarm_${soundId}`;
}

/** Android 용 channelId 를 받아, 수신자 플랫폼에 맞는 Expo Push 의 sound 값을 돌려준다. */
function soundForPlatform(platform: string | null | undefined, channelId: string): string {
  if (platform === 'ios') {
    const presetFile = presetFileIdFromChannel(channelId);
    if (presetFile) return `${presetFile}.caf`;
    const soundId = soundIdFromChannel(channelId);
    if (soundId) return alarmSoundFileNameIOS(soundId);
  }
  return 'default';
}

async function sendPush(
  to: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
  channelId = 'default',
  platform: string | null = null,
): Promise<void> {
  try {
    const sound = soundForPlatform(platform, channelId);
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' },
      body: JSON.stringify({ to, sound, title, body, data, priority: 'high', channelId }),
    });
    const result = await res.json();
    console.log('[notify-diary-entry] sendPush', JSON.stringify({ to: to.slice(0, 30), title, channelId, sound, status: res.status, result }));
  } catch (e) {
    console.error('[notify-diary-entry] sendPush error:', e);
  }
}

async function logNotification(userId: string, title: string, body: string, data: Record<string, unknown>): Promise<void> {
  try {
    await supabase.from('notification_logs').insert({ user_id: userId, type: 'family_diary', title, body, data, read_at: null });
  } catch (e) {
    console.warn('[notify-diary-entry] logNotification 실패:', e);
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body: ReqBody = await req.json().catch(() => ({}));
    const patientId = body?.patient_id;
    const entryDate = body?.entry_date;
    const authorId = body?.author_id;

    if (!patientId || !entryDate || !authorId) {
      return json({ error: 'patient_id, entry_date, author_id 필드가 필요합니다.' }, 400);
    }

    // 인증: 호출자 = 작성자 본인만 트리거 가능(위조 방지)
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user: caller }, error: authErr } = await supabase.auth.getUser(jwt);
    if (authErr || !caller) return json({ error: 'unauthorized' }, 401);
    if (caller.id !== authorId) return json({ error: 'forbidden' }, 403);

    // 환자(그룹) + 작성자 이름
    const { data: patientRow } = await supabase
      .from('users')
      .select('patient_group_id')
      .eq('id', patientId)
      .maybeSingle();
    const groupId = (patientRow as any)?.patient_group_id ?? null;
    if (!groupId) return json({ sent: 0, reason: 'no_group_linked' });

    const { data: authorRow } = await supabase.from('users').select('name').eq('id', authorId).maybeSingle();
    const authorName = (authorRow as any)?.name ?? '가족';

    // 그룹 보호자 목록
    const { data: members } = await supabase
      .from('patient_group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .eq('role', 'caregiver');
    const caregiverIds = (members ?? [])
      .map((m: any) => m?.user_id)
      .filter((v: any): v is string => typeof v === 'string' && v.length > 0);

    // 수신자 = 환자 + 보호자 전원 − 작성자 (중복 제거)
    const recipientIds = Array.from(new Set([patientId, ...caregiverIds])).filter((id) => id !== authorId);
    if (recipientIds.length === 0) return json({ sent: 0, reason: 'no_recipients' });

    const { data: recipients } = await supabase
      .from('users')
      .select('id, push_token, push_platform, notification_enabled, diary_notif_enabled, diary_notif_sound_id, language')
      .in('id', recipientIds);

    let sent = 0;
    let skipped = 0;
    for (const u of recipients ?? []) {
      const token = (u as any)?.push_token as string | null;
      if (!token) { skipped += 1; continue; }
      if ((u as any)?.notification_enabled === false) { skipped += 1; continue; }
      // 가족 일기 알림 토글 — 기본 ON(false 명시일 때만 스킵)
      if ((u as any)?.diary_notif_enabled === false) { skipped += 1; continue; }

      const isEn = (u as any)?.language === 'en';
      const title = isEn ? `📔 ${authorName} wrote in the family diary` : `📔 ${authorName}님이 가족 일기를 남겼어요`;
      const bodyText = isEn ? 'Tap to view the family diary.' : '가족 일기를 확인해보세요.';
      const payload = { type: 'family_diary', date: entryDate, patient_id: patientId };
      const channelId = channelForStoredSound((u as any)?.diary_notif_sound_id ?? null);
      const platform = (u as any)?.push_platform ?? null;

      await sendPush(token, title, bodyText, payload, channelId, platform);
      await logNotification((u as any).id, title, bodyText, payload);
      sent += 1;
    }

    return json({ sent, skipped, recipients: recipients?.length ?? 0 });
  } catch (err: any) {
    console.error('[notify-diary-entry] fatal error:', err);
    return json({ error: err?.message ?? '발송 실패' }, 500);
  }
});

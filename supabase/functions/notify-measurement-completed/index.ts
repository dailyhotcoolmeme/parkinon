// 디지털 바이오마커 MVP-A Phase 5A — 환자 측정 완료 → 보호자 푸시 (cross-user)
// 참고: docs/digital_biomarker_mvpA_spec.md §5.1, §7.4
//
// 입력(JSON body):
//   - measurement_id: string (필수)
//
// 동작:
//   1) measurement row 조회(서비스 롤) → user_id(=환자), type 확보
//   2) 환자의 patient_group_id 조회
//   3) 같은 group의 보호자(role='caregiver') 목록 조회 → push_token, caregiver_notif_prefs
//   4) 토글 'measurement_completed' OFF(false) 이면 스킵, 기본 ON(미지정/true 모두 발송)
//   5) Expo Push API로 발송 (categoryId 없음 — 액션 버튼 불필요)
//   6) notification_logs 저장(미읽음)
//
// 절대 원칙(CLAUDE.md):
//   - 로컬 알림 대체 금지. cross-user는 서버 푸시 필수.
//   - effect_tracking_queue / queue-effect-tracking / process-notification-queue
//     무수정. 본 함수는 신규 경로.
//
// 푸시 카피(중립·돌봄 톤, 의학 판정 표현 금지):
//   title: "🖐️ [환자]님이 컨디션 측정을 했어요"
//   body : "오늘 측정 결과를 확인해보세요."
//
// payload data: { type: 'measurement_completed', measurement_type, patient_id, measurement_id }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveLang, t } from '../_shared/i18n.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

interface ReqBody {
  measurement_id?: string;
}

async function sendPush(
  to: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify({
        to,
        sound: 'default',
        title,
        body,
        data,
        priority: 'high',
        channelId: 'default',
      }),
    });
    const result = await res.json();
    console.log(
      '[notify-measurement-completed] sendPush',
      JSON.stringify({ to: to.slice(0, 30), title, status: res.status, result }),
    );
  } catch (e) {
    console.error('[notify-measurement-completed] sendPush error:', e);
  }
}

async function logNotification(
  userId: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from('notification_logs').insert({
      user_id: userId,
      type: 'measurement_completed',
      title,
      body,
      data,
      read_at: null,
    });
  } catch (e) {
    // 알림 자체 발송 흐름은 막지 않음
    console.warn('[notify-measurement-completed] logNotification 실패:', e);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: ReqBody = await req.json().catch(() => ({}));
    const measurementId = body?.measurement_id;

    if (!measurementId || typeof measurementId !== 'string') {
      return new Response(
        JSON.stringify({ error: 'measurement_id field is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // 인증: 호출자 JWT 검증. 아래에서 측정 소유자 본인인지 추가 확인
    // (타인의 measurement_id 로 보호자 푸시 스팸·알림로그 위조 방지).
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user: caller }, error: authErr } = await supabase.auth.getUser(jwt);
    if (authErr || !caller) {
      return new Response(
        JSON.stringify({ error: 'unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 1) measurement row 조회
    const { data: mRow, error: mErr } = await supabase
      .from('measurements')
      .select('id, user_id, type, deleted_at')
      .eq('id', measurementId)
      .maybeSingle();

    if (mErr) {
      console.error('[notify-measurement-completed] measurement 조회 오류:', mErr);
      return new Response(
        JSON.stringify({ error: 'failed to load measurement', detail: mErr.message }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }
    if (!mRow || mRow.deleted_at) {
      return new Response(
        JSON.stringify({ skipped: true, reason: 'measurement_not_found_or_deleted' }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    const patientId: string = mRow.user_id;
    const measurementType: string = mRow.type; // 'tap' | 'reaction'

    // 소유자 검증: 측정한 환자 본인만 자신의 측정 완료 알림을 트리거할 수 있음
    // (보호자 대리 측정 금지 — spec §5.1).
    if (patientId !== caller.id) {
      return new Response(
        JSON.stringify({ error: 'forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 2) 환자 정보 (이름·patient_group_id)
    const { data: patientRow, error: pErr } = await supabase
      .from('users')
      .select('name, patient_group_id')
      .eq('id', patientId)
      .maybeSingle();

    if (pErr) {
      console.error('[notify-measurement-completed] patient 조회 오류:', pErr);
      return new Response(
        JSON.stringify({ error: 'failed to load patient', detail: pErr.message }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    const patientName = patientRow?.name ?? '환자분';
    const groupId = patientRow?.patient_group_id ?? null;

    if (!groupId) {
      // 가족 연동 전 — 발송 대상 없음
      return new Response(
        JSON.stringify({ sent: 0, reason: 'no_group_linked' }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // 3) 같은 group의 보호자 user_id 목록
    const { data: members, error: gmErr } = await supabase
      .from('patient_group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .eq('role', 'caregiver');

    if (gmErr) {
      console.error('[notify-measurement-completed] group_members 조회 오류:', gmErr);
      return new Response(
        JSON.stringify({ error: 'failed to load group members', detail: gmErr.message }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    const caregiverIds = (members ?? [])
      .map((m: any) => m?.user_id)
      .filter((v: any): v is string => typeof v === 'string' && v.length > 0);

    if (caregiverIds.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, reason: 'no_caregivers' }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // 4) 보호자 push_token + caregiver_notif_prefs 일괄 조회
    const { data: caregiverUsers, error: cuErr } = await supabase
      .from('users')
      .select('id, push_token, caregiver_notif_prefs, notification_enabled, language')
      .in('id', caregiverIds);

    if (cuErr) {
      console.error('[notify-measurement-completed] caregiver users 조회 오류:', cuErr);
      return new Response(
        JSON.stringify({ error: 'failed to load caregiver users', detail: cuErr.message }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // 5) 발송 — 수신 보호자 언어(ko/en)별 문구 분기(다른 알림 함수와 동일 패턴).
    const payload = {
      type: 'measurement_completed',
      measurement_type: measurementType,
      patient_id: patientId,
      measurement_id: measurementId,
    };

    let sent = 0;
    let skipped = 0;

    for (const cu of caregiverUsers ?? []) {
      const token = (cu as any)?.push_token as string | null;
      if (!token) {
        skipped += 1;
        continue;
      }
      // 전체 알림 OFF
      if ((cu as any)?.notification_enabled === false) {
        skipped += 1;
        continue;
      }
      // 보호자 측정 알림 토글 — 기본 ON (false 명시일 때만 스킵)
      const prefs = ((cu as any)?.caregiver_notif_prefs ?? {}) as Record<
        string,
        boolean
      >;
      if (prefs.measurement_completed === false) {
        skipped += 1;
        continue;
      }

      const lang = resolveLang((cu as any)?.language);
      const title = t(lang, 'measurement.title', { name: patientName });
      const bodyText = t(lang, 'measurement.body');

      await sendPush(token, title, bodyText, payload);
      await logNotification((cu as any).id, title, bodyText, payload);
      sent += 1;
    }

    return new Response(
      JSON.stringify({ sent, skipped, caregivers: caregiverUsers?.length ?? 0 }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (err: any) {
    console.error('[notify-measurement-completed] fatal error:', err);
    return new Response(
      JSON.stringify({ error: err?.message ?? 'send failed' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});

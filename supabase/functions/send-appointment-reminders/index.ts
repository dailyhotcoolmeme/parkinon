// send-appointment-reminders
// 진료 일정(medical_appointments) D-7 / D-1 서버 푸시 알림 (매분 pg_cron 실행).
// - 로컬 예약(기기 의존)을 대체하는 서버 정본. 재설치·기기변경·보호자 등록에도 안전.
// - 조건: appointment_date 가 미래 AND (appointment_date - 7/1일 <= now) AND notify_* AND NOT notified_*
//   → 환자에게 푸시 + notified_* = true (1회 발송 보장). 이미 지난 D-시점도 첫 실행에서 따라잡아 발송.
// 발송 문구는 앱(AppointmentWrite/MedicalRecordList)과 동일하게 유지.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토']

/** 진료 일시(UTC ISO) → KST 'M월 D일(요일) 오전/오후 H:MM'. 앱 apptWhenKor 과 동일 형식. */
function kstWhen(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000) // KST로 시프트 후 UTC getter 사용
  const mo = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  const dow = DAYS_KR[d.getUTCDay()]
  const h = d.getUTCHours()
  const m = d.getUTCMinutes()
  const ampm = h < 12 ? '오전' : '오후'
  let h12 = h % 12
  if (h12 === 0) h12 = 12
  return `${mo}월 ${day}일(${dow}) ${ampm} ${h12}:${String(m).padStart(2, '0')}`
}

/** 수신자의 알림음 설정 → Android 채널 ID. (send-medication-reminders 와 동일 규칙) */
async function resolveAlarmChannel(userId: string): Promise<string> {
  const { data } = await supabase
    .from('alarm_sound_prefs')
    .select('sound_type, custom_sound_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (data?.sound_type === 'recorded' && data.custom_sound_id) {
    return `parkinon_alarm_${data.custom_sound_id}`
  }
  return 'default'
}

// ─── iOS 커스텀 알림음(가족 목소리) ──────────────────────────────────────────
// Android 는 채널(channelId=`parkinon_alarm_<soundId>`)로 커스텀음을 울리지만,
// iOS 는 Library/Sounds/<파일명>.caf 를 푸시 payload 의 sound 문자열로 지정해야 한다.
// 파일명 규칙 = 클라 alarmSoundFileNameIOS 와 1:1 동일: `parkinon_<soundId>.caf`.
//
// ⚠️ 미검증(설계서 PoC): Expo Push 가 iOS 에 임의 사운드 파일명을 APNs aps.sound 로
//   실제 전달하는지 새 빌드 후 실측 전까지 단정 불가. 안 울리면 APNs 직접 발송으로 전환.
function soundForPlatform(platform: string | null | undefined, channelId: string): string {
  if (platform === 'ios') {
    const m = channelId.match(/^parkinon_alarm_(.+)$/)
    if (m) return `parkinon_${m[1]}.caf`
  }
  return 'default'
}

async function sendPush(
  to: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
  channelId = 'default',
  platform: string | null = null,
) {
  // iOS 커스텀음은 sound 문자열, Android 는 channelId 로 좌우(sound='default').
  const sound = soundForPlatform(platform, channelId)
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, sound, title, body, data, priority: 'high', channelId }),
  })
  const result = await res.json()
  console.log('[sendPush]', JSON.stringify({ to: to.slice(0, 30), title, channelId, sound, platform, status: res.status, result }))
}

async function logNotification(userId: string, type: string, title: string, body: string, data: Record<string, unknown>) {
  await supabase.from('notification_logs').insert({
    user_id: userId, type, title, body, data, read_at: null,
  })
}

interface ApptRow {
  id: string
  patient_id: string
  hospital_name: string | null
  appointment_date: string
}

async function processBucket(rows: ApptRow[] | null, kind: 'week' | 'day') {
  const notifiedCol = kind === 'week' ? 'notified_week' : 'notified_day'
  let sent = 0
  for (const appt of rows ?? []) {
    const { data: patient } = await supabase
      .from('users')
      .select('push_token, push_platform')
      .eq('id', appt.patient_id)
      .single()
    // 진료 알림은 사용자가 직접 등록한 일정의 per-진료 토글(notify_week_before/notify_day_before,
    // 후보 쿼리에서 이미 필터됨)에만 종속한다. 약효 추적/운동 토글이 자동 계산하는
    // users.notification_enabled 마스터 게이트에는 영향받지 않음 — 효과추적·운동만 꺼도
    // 진료 알림은 유지되어야 한다. 토큰만 확인(없으면 보류: 나중에 발급되면 윈도우 안에서 발송).
    if (!patient?.push_token) continue

    const hosp = appt.hospital_name?.trim() || '진료'
    const when = kstWhen(appt.appointment_date)
    const body = kind === 'week'
      ? `${hosp} 진료가 1주일 후입니다.\n${when}`
      : `${hosp} 진료가 내일입니다.\n${when}`
    const channelId = await resolveAlarmChannel(appt.patient_id)
    const data = { type: 'appointment_reminder', appointmentId: appt.id, kind }

    await sendPush(patient.push_token, '🏥 진료 일정 알림', body, data, channelId, (patient as any).push_platform ?? null)
    await logNotification(appt.patient_id, 'appointment_reminder', '🏥 진료 일정 알림', body, data)
    await supabase.from('medical_appointments').update({ [notifiedCol]: true }).eq('id', appt.id)
    sent++
  }
  return sent
}

/** appointment_date 가 (now, now+days] 윈도우 안인지 — 날짜 비교는 JS에서 처리(직렬화 이슈 회피). */
function inWindow(iso: string, nowMs: number, days: number): boolean {
  const t = new Date(iso).getTime()
  return t > nowMs && t <= nowMs + days * 24 * 60 * 60 * 1000
}

Deno.serve(async () => {
  const now = new Date()
  const nowMs = now.getTime()

  // D-7 후보: 1주일 전 알림 켜짐 & 아직 미발송. 날짜 윈도우는 JS에서 필터.
  const { data: weekCand, error: weekErr } = await supabase
    .from('medical_appointments')
    .select('id, patient_id, hospital_name, appointment_date')
    .eq('notify_week_before', true)
    .eq('notified_week', false)
  if (weekErr) console.error('[weekCand]', weekErr.message)

  // D-1 후보
  const { data: dayCand, error: dayErr } = await supabase
    .from('medical_appointments')
    .select('id, patient_id, hospital_name, appointment_date')
    .eq('notify_day_before', true)
    .eq('notified_day', false)
  if (dayErr) console.error('[dayCand]', dayErr.message)

  const weekDue = (weekCand as ApptRow[] | null ?? []).filter((a) => inWindow(a.appointment_date, nowMs, 7))
  const dayDue = (dayCand as ApptRow[] | null ?? []).filter((a) => inWindow(a.appointment_date, nowMs, 1))

  const week = await processBucket(weekDue, 'week')
  const day = await processBucket(dayDue, 'day')

  return new Response(JSON.stringify({ week, day, time: now.toISOString() }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { nextBadgeCountByToken } from '../_shared/badge.ts'
import { resolveLang, t, periodKeyFor, type Lang, slotLabelWithTime } from '../_shared/i18n.ts'

/** 유효한 legacy 시간대 키. 표시용이 아니라 요청 검증용이다. */
const LEGACY_MEAL_KEYS = new Set(['morning', 'lunch', 'dinner', 'bedtime'])

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// ─── {시간대} {시각} 표기 (send-medication-reminders 와 1:1 동일 복제) ──────────

const LEGACY_MEAL_DEFAULT_TIME: Record<string, string> = {
  morning: '08:00',
  lunch: '12:00',
  dinner: '18:00',
  bedtime: '22:00',
}

/** 'HH:MM[:SS]' → 12시간제 'H:MM' (오전/오후 없이). 예 '18:00'→'6:00'. */
function formatClockTime(hhmm: string | null | undefined): string {
  if (!hhmm) return ''
  const parts = hhmm.split(':')
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1] ?? '0', 10)
  if (Number.isNaN(h)) return ''
  let displayH = h % 12
  if (displayH === 0) displayH = 12
  const mm = String(Number.isNaN(m) ? 0 : m).padStart(2, '0')
  return `${displayH}:${mm}`
}

/** periodLabel + clock → "{시간대} {시각}" (한쪽만 있으면 그것만, 둘 다 없으면 ''). */
function periodWithTime(periodLabel: string, clock: string): string {
  return [periodLabel, clock].filter(Boolean).join(' ')
}

/**
 * 알림 body 생성 — 언어별 문구는 _shared/i18n.ts 한 곳에만 있다.
 * label(시간대) + time(시각) 을 합쳐 {{when}} 에 넣는다. 둘 다 없으면 시간대 없는 문구로 폴백.
 */
function bodyFor(
  lang: Lang,
  kind: 'missed' | 'caregiverMissed',
  time: string | null | undefined,
  subject?: string,
  legacyKey?: string | null,
): string {
  // DB 의 label(한글)은 보지 않는다 — legacy_key 와 시각만으로 만든다.
  // (label 한글 파싱은 프랑스어·일본어 사용자 슬롯에서 애초에 실패한다.)
  const when = slotLabelWithTime(lang, legacyKey, time)
  const keys = kind === 'missed'
    ? ['med.missed.body', 'med.missed.bodyNoTime']
    : ['med.missed.caregiverBody', 'med.missed.caregiverBodyNoTime']
  return t(lang, when ? keys[0] : keys[1], { when, subject: subject ?? '' })
}

/** 주어진 IANA tz에서 "오늘" 날짜(YYYY-MM-DD). en-CA 포맷이 그대로 YYYY-MM-DD. */
function localTodayStr(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
}

/**
 * 주어진 IANA tz에서 dateStr(YYYY-MM-DD)의 00:00:00~23:59:59 벽시계 경계를
 * UTC ISO 문자열로 변환(send-medication-reminders 의 localDayRangeUtc 와 1:1 동일 기법).
 * Asia/Seoul(DST 없음)에서는 기존 `${today}T00:00:00+09:00`~`T23:59:59+09:00`와 동일 순간(회귀 0).
 */
function localDayRangeUtc(dateStr: string, tz: string): { start: string; end: string } {
  const [y, m, d] = dateStr.split('-').map(Number)
  const guess = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0))
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = fmt.formatToParts(guess).reduce((acc, p) => {
    acc[p.type] = p.value
    return acc
  }, {} as Record<string, string>)
  const hour = parts.hour === '24' ? '00' : parts.hour
  const localAsUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(hour), Number(parts.minute), Number(parts.second),
  )
  const offsetMs = localAsUtc - guess.getTime()
  const start = new Date(guess.getTime() - offsetMs)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1000)
  return { start: start.toISOString(), end: end.toISOString() }
}

async function sendPush(to: string, title: string, body: string, data: Record<string, unknown>) {
  // 앱이 꺼져 있으면 앱이 배지를 못 맞추므로 푸시에 숫자를 실어 보낸다.
  const __badge = await nextBadgeCountByToken(supabase, to)
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      sound: 'default',
      title,
      body,
      data,
      priority: 'high',
      ...(__badge !== undefined ? { badge: __badge } : {}),
      channelId: 'default',
    }),
  })
}

/**
 * 이 함수는 유지(폐기 안 함). 구버전 호환을 위해 기존 meal_time 경로를 100% 보존하고,
 * 신규 dose_slot_id 요청도 받을 수 있게 이중 분기를 추가한다.
 *
 * 요청 형태(둘 중 하나):
 *  - 구(legacy):  { meal_time: 'morning' | 'lunch' | 'dinner' | 'bedtime' }
 *  - 신(dose_slot): { dose_slot_id: '<uuid>' }  (meal_time 동시 전달 가능, 옵션)
 */
Deno.serve(async (req: Request) => {
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const meal_time: string | undefined = body.meal_time
  const dose_slot_id: string | undefined = body.dose_slot_id

  // ─── 분기 결정 ───────────────────────────────────────────────────
  // dose_slot_id가 오면 신규 경로(특정 환자 슬롯), 아니면 구 meal_time 경로(전체 환자).
  if (!dose_slot_id && (!meal_time || !LEGACY_MEAL_KEYS.has(meal_time))) {
    return new Response(JSON.stringify({ error: 'invalid request: meal_time or dose_slot_id required' }), { status: 400 })
  }

  // 하루 경계는 이제 환자별 tz로 개별 계산(Phase1-S3c, 전역 KST today 제거).
  // 아래 두 경로(신규 dose_slot_id / 구 legacy meal_time) 각각에서 patient.timezone 기준으로 산출.

  let patientSent = 0
  let caregiverSent = 0

  // ============================================================
  // 신규 경로: dose_slot_id 1개 — 그 슬롯 환자에게만
  // ============================================================
  if (dose_slot_id) {
    const { data: slot } = await supabase
      .from('dose_slots')
      .select('id, patient_id, label, legacy_key, time, remind_enabled, is_active')
      .eq('id', dose_slot_id)
      .maybeSingle()

    if (!slot || !slot.is_active || slot.remind_enabled === false) {
      return new Response(JSON.stringify({ patientSent: 0, caregiverSent: 0, skipped: 'slot inactive/disabled' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { data: patient } = await supabase
      .from('users')
      .select('id, name, push_token, notification_enabled, patient_group_id, language, timezone')
      .eq('id', slot.patient_id)
      .maybeSingle()

    if (!patient?.push_token || !patient.notification_enabled) {
      return new Response(JSON.stringify({ patientSent: 0, caregiverSent: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const patientLang = resolveLang((patient as any).language)
    const patientTz = (patient as any).timezone || 'Asia/Seoul'
    const { start: dayStart, end: dayEnd } = localDayRangeUtc(localTodayStr(patientTz), patientTz)

    // 복용 여부: dose_slot_id 기록 + (있다면) meal_time 기록 union
    const { data: bySlot } = await supabase
      .from('med_logs')
      .select('id')
      .eq('patient_id', patient.id)
      .eq('dose_slot_id', dose_slot_id)
      .gte('taken_at', dayStart)
      .lte('taken_at', dayEnd)
      .limit(1)
    let taken = !!bySlot?.length
    if (!taken && meal_time && LEGACY_MEAL_KEYS.has(meal_time)) {
      const { data: byMeal } = await supabase
        .from('med_logs')
        .select('id')
        .eq('patient_id', patient.id)
        .eq('meal_time', meal_time)
        .gte('taken_at', dayStart)
        .lte('taken_at', dayEnd)
        .limit(1)
      taken = !!byMeal?.length
    }

    if (taken) {
      return new Response(JSON.stringify({ patientSent: 0, caregiverSent: 0, skipped: 'already taken' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ⚠️ 재시도 횟수 제한 — 원래 설계(1차 알림 → +10분 재알림 → +10분 후 보호자까지 알림,
    //   그리고 끝)와 다르게, 이전엔 "오늘 복용했는가"만 보고 무조건 재발송해서 외부 호출이
    //   있는 한 무한 반복됐다(오너 제보 2026-08-01, 5~10분 간격으로 계속 옴). 오늘 이 슬롯에
    //   이미 보낸 '미복용' 알림 횟수를 세서, 2회(재알림 1 + 보호자escalation 1) 도달하면 멈춘다.
    const { count: alreadySent } = await supabase
      .from('notification_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', patient.id)
      .eq('type', 'missed_medication')
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd)
      .contains('data', { doseSlotId: dose_slot_id })
    if ((alreadySent ?? 0) >= 2) {
      return new Response(JSON.stringify({ patientSent: 0, caregiverSent: 0, skipped: 'max retries reached' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const patientTitle = t(patientLang, 'med.missed.title')
    const patientBody = bodyFor(patientLang, 'missed', (slot as any).time, undefined, (slot as any).legacy_key ?? meal_time)
    await sendPush(
      patient.push_token,
      patientTitle,
      patientBody,
      { type: 'missed_medication', mealTime: meal_time ?? null, doseSlotId: dose_slot_id },
    )
    patientSent++
    // 서버가 직접 기록 — 클라이언트가 푸시를 못 받는 상황(앱 종료 등)에서도 재시도 횟수
    // 카운트가 정확해야 위 상한선이 제대로 작동한다.
    await supabase.from('notification_logs').insert({
      user_id: patient.id,
      type: 'missed_medication',
      title: patientTitle,
      body: patientBody,
      data: { type: 'missed_medication', mealTime: meal_time ?? null, doseSlotId: dose_slot_id },
    })

    if (patient.patient_group_id) {
      const { data: caregivers } = await supabase
        .from('patient_group_members')
        .select('user_id')
        .eq('group_id', patient.patient_group_id)
        .eq('role', 'caregiver')

      if (caregivers?.length) {
        const { data: caregiverUsers } = await supabase
          .from('users')
          .select('id, push_token, caregiver_notif_prefs, language')
          .in('id', caregivers.map((c: any) => c.user_id))
          .not('push_token', 'is', null)

        const patientName = (patient as any).name?.trim()
        const subjectFor = (l: Lang) => patientName
          ? t(l, 'patient.honorific', { name: patientName })
          : t(l, 'patient.fallbackName')

        for (const cu of caregiverUsers ?? []) {
          if (!cu.push_token) continue
          const prefs = (cu.caregiver_notif_prefs ?? {}) as Record<string, boolean>
          if (prefs.med_missed === false) continue
          const cuLang = resolveLang((cu as any).language)
          const cgTitle = t(cuLang, 'med.missed.title')
          const cgBody = bodyFor(cuLang, 'caregiverMissed', (slot as any).time,
            subjectFor(cuLang), (slot as any).legacy_key ?? meal_time)
          await sendPush(cu.push_token, cgTitle, cgBody, {
            type: 'caregiver_missed_med',
            mealTime: meal_time ?? null,
            doseSlotId: dose_slot_id,
          })
          await supabase.from('notification_logs').insert({
            user_id: cu.id,
            type: 'caregiver_missed_med',
            title: cgTitle,
            body: cgBody,
            data: { type: 'caregiver_missed_med', mealTime: meal_time ?? null, doseSlotId: dose_slot_id },
          })
          caregiverSent++
        }
      }
    }

    return new Response(JSON.stringify({ patientSent, caregiverSent }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ============================================================
  // 구 경로 (legacy, 100% 보존): meal_time — 전체 환자 순회
  // ============================================================
  const { data: patients } = await supabase
    .from('users')
    .select('id, name, push_token, patient_group_id, med_time_notif_prefs, language, timezone')
    .eq('role', 'patient')
    .eq('notification_enabled', true)
    .not('push_token', 'is', null)

  if (!patients?.length) {
    return new Response(JSON.stringify({ sent: 0 }), { headers: { 'Content-Type': 'application/json' } })
  }

  for (const patient of patients) {
    if (!patient.push_token) continue

    // med_time_notif_prefs 확인: 해당 meal_time 알림이 꺼져 있으면 건너뜀
    // prefs 구조: { morning: boolean, lunch: boolean, dinner: boolean, bedtime: boolean }
    // null/undefined이면 기본값 true (알림 활성화)
    const medTimePrefs = (patient.med_time_notif_prefs ?? {}) as Record<string, boolean>
    if (medTimePrefs[meal_time!] === false) continue

    // 환자별 tz로 하루 경계 개별 산출(Phase1-S3c). tz='Asia/Seoul'이면 기존과 동일 순간(회귀 0).
    const patientTz = (patient as any).timezone || 'Asia/Seoul'
    const { start: dayStart, end: dayEnd } = localDayRangeUtc(localTodayStr(patientTz), patientTz)

    const { data: logs } = await supabase
      .from('med_logs')
      .select('id')
      .eq('patient_id', patient.id)
      .eq('meal_time', meal_time)
      .gte('taken_at', dayStart)
      .lte('taken_at', dayEnd)
      .limit(1)

    if (logs?.length) continue

    const patientLang = resolveLang((patient as any).language)
    const patientTitle = t(patientLang, 'med.missed.title')
    const patientBody = bodyFor(patientLang, 'missed',
      LEGACY_MEAL_DEFAULT_TIME[meal_time!], undefined, meal_time)
    await sendPush(
      patient.push_token,
      patientTitle,
      patientBody,
      { type: 'missed_medication', mealTime: meal_time },
    )
    patientSent++

    if (patient.patient_group_id) {
      const { data: caregivers } = await supabase
        .from('patient_group_members')
        .select('user_id')
        .eq('group_id', patient.patient_group_id)
        .eq('role', 'caregiver')

      if (caregivers?.length) {
        const { data: caregiverUsers } = await supabase
          .from('users')
          .select('id, push_token, caregiver_notif_prefs, language')
          .in('id', caregivers.map((c: any) => c.user_id))
          .not('push_token', 'is', null)

        for (const cu of caregiverUsers ?? []) {
          if (!cu.push_token) continue
          const prefs = (cu.caregiver_notif_prefs ?? {}) as Record<string, boolean>
          if (prefs.med_missed === false) continue

          const patientName = (patient as any).name?.trim()
          const subjectFor = (l: Lang) => patientName
          ? t(l, 'patient.honorific', { name: patientName })
          : t(l, 'patient.fallbackName')
            const cuLang = resolveLang((cu as any).language)
          const cgTitle = t(cuLang, 'med.missed.title')
          // 구 경로: meal_time → 라벨 + 기본 시각으로 {시간대} {시각} 구성.
          const cgBody = bodyFor(cuLang, 'caregiverMissed',
            LEGACY_MEAL_DEFAULT_TIME[meal_time!],
            subjectFor(cuLang), meal_time)
          await sendPush(
            cu.push_token,
            cgTitle,
            cgBody,
            { type: 'caregiver_missed_med', mealTime: meal_time },
          )
          // 보호자 종 아이콘 알림 내역용 기록 (service role)
          await supabase.from('notification_logs').insert({
            user_id: cu.id,
            type: 'caregiver_missed_med',
            title: cgTitle,
            body: cgBody,
            data: { type: 'caregiver_missed_med', mealTime: meal_time },
          })
          caregiverSent++
        }
      }
    }
  }

  return new Response(JSON.stringify({ patientSent, caregiverSent }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

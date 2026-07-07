import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const INTERVAL_LABELS: Record<number, string> = {
  0: '복용 직후',
  30: '30분 후',
  120: '2시간 후',
}
const INTERVAL_LABELS_EN: Record<number, string> = {
  0: 'right after taking',
  30: '30 min later',
  120: '2 hr later',
}

// legacy 4슬롯 라벨 fallback. dose_slot.label 이 있으면 그 값을 우선 사용.
const MEAL_LABELS: Record<string, string> = {
  morning: '아침',
  lunch: '점심',
  dinner: '저녁',
  bedtime: '취침',
}
const MEAL_LABELS_EN: Record<string, string> = {
  morning: 'Morning',
  lunch: 'Lunch',
  dinner: 'Dinner',
  bedtime: 'Bedtime',
}

// ─── {시간대} {시각} 표기 (send-medication-reminders 와 1:1 동일 복제) ──────────
// 약효추적 본문은 약 이름(slotTitle "아침 오전 8:10")이 아니라,
// 정시/미복용 알림과 동일한 "{시간대} {시각}"(예 "저녁 6:00") 표기를 쓴다.
// periodLabelFor + formatClockTime 두 헬퍼를 send-medication-reminders 에서 복제.

const STANDARD_LABELS = new Set(['아침', '점심', '저녁', '취침'])

/**
 * 'HH:MM[:SS]' → 시간대 단어(앱 doseSlots.periodWord 와 1:1 동일).
 * 새벽 0–6 / 아침 6–11 / 점심 11–13 / 오후 13–17 / 저녁 17–21 / 밤 21–24.
 */
function periodWord(time: string | null | undefined): string {
  if (!time) return ''
  const h = parseInt(time.split(':')[0] ?? '', 10)
  if (Number.isNaN(h)) return ''
  if (h < 6) return '새벽'
  if (h < 11) return '아침'
  if (h < 13) return '점심'
  if (h < 17) return '오후'
  if (h < 21) return '저녁'
  return '밤'
}

/** 푸시 문구 {시간대} 라벨. 표준 라벨 우선, 없으면 시각 기반 periodWord. */
function periodLabelFor(label: string | null | undefined, time: string | null | undefined): string {
  const trimmed = (label ?? '').trim()
  if (trimmed && STANDARD_LABELS.has(trimmed)) return trimmed
  const p = periodWord(time)
  if (p) return p
  return ''
}

/** periodWord 영어판 — 앱 doseSlots.periodWord isEnLocale 분기와 1:1 동일. */
function periodWordEn(time: string | null | undefined): string {
  if (!time) return ''
  const h = parseInt(time.split(':')[0] ?? '', 10)
  if (Number.isNaN(h)) return ''
  if (h < 6) return 'Early morning'
  if (h < 11) return 'Morning'
  if (h < 13) return 'Midday'
  if (h < 17) return 'Afternoon'
  if (h < 21) return 'Evening'
  return 'Night'
}

/** periodLabelFor 영어판 */
function periodLabelForEn(label: string | null | undefined, time: string | null | undefined): string {
  const trimmed = (label ?? '').trim()
  if (trimmed && STANDARD_LABELS.has(trimmed)) {
    const key = Object.keys(MEAL_LABELS).find((k) => MEAL_LABELS[k] === trimmed)
    if (key) return MEAL_LABELS_EN[key]
  }
  const p = periodWordEn(time)
  if (p) return p
  return ''
}

/**
 * 'HH:MM[:SS]' → 12시간제 'H:MM' (오전/오후 없이). 푸시 문구의 시각 표기용.
 * 예: '18:00'→'6:00', '08:00'→'8:00', '12:00'→'12:00', '00:00'→'12:00'.
 */
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
 * 약효추적 본문의 "{시간대} {시각}" 머리말 결정.
 *  - 신규: dose_slot(label, time) 으로 periodLabelFor + formatClockTime.
 *  - 구(legacy): dose_slot 없으면 meal_time 라벨 + MEAL_TIMES 기본 시각.
 *  - 둘 다 못 구하면 '' (호출처가 폴백 문구 사용).
 */
const LEGACY_MEAL_DEFAULT_TIME: Record<string, string> = {
  morning: '08:00',
  lunch: '12:00',
  dinner: '18:00',
  bedtime: '22:00',
}

function resolvePeriodHead(
  doseSlot: { label?: string | null; time?: string | null } | null | undefined,
  mealTime: string | null | undefined,
): string {
  if (doseSlot && (doseSlot.label || doseSlot.time)) {
    const head = periodWithTime(
      periodLabelFor(doseSlot.label, doseSlot.time),
      formatClockTime(doseSlot.time),
    )
    if (head) return head
  }
  if (mealTime && MEAL_LABELS[mealTime]) {
    return periodWithTime(MEAL_LABELS[mealTime], formatClockTime(LEGACY_MEAL_DEFAULT_TIME[mealTime]))
  }
  return ''
}

/** resolvePeriodHead 영어판 */
function resolvePeriodHeadEn(
  doseSlot: { label?: string | null; time?: string | null } | null | undefined,
  mealTime: string | null | undefined,
): string {
  if (doseSlot && (doseSlot.label || doseSlot.time)) {
    const head = periodWithTime(
      periodLabelForEn(doseSlot.label, doseSlot.time),
      formatClockTime(doseSlot.time),
    )
    if (head) return head
  }
  if (mealTime && MEAL_LABELS_EN[mealTime]) {
    return periodWithTime(MEAL_LABELS_EN[mealTime], formatClockTime(LEGACY_MEAL_DEFAULT_TIME[mealTime]))
  }
  return ''
}

function getIntervalLabel(minutes: number): string {
  if (INTERVAL_LABELS[minutes]) return INTERVAL_LABELS[minutes]
  if (minutes < 60) return `${minutes}분 후`
  const h = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem === 0 ? `${h}시간 후` : `${h}시간 ${rem}분 후`
}

/** getIntervalLabel 영어판 */
function getIntervalLabelEn(minutes: number): string {
  if (INTERVAL_LABELS_EN[minutes]) return INTERVAL_LABELS_EN[minutes]
  if (minutes < 60) return `${minutes} min later`
  const h = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem === 0 ? `${h} hr later` : `${h} hr ${rem} min later`
}

// ─── iOS 커스텀 알림음(가족 목소리) ──────────────────────────────────────────
// Android 는 채널(channelId=`parkinon_alarm_<soundId>`)로 커스텀음을 울리지만,
// iOS 는 Library/Sounds/<파일명>.caf 를 푸시 payload 의 sound 문자열로 지정해야 한다.
// 파일명 규칙 = 클라 alarmSoundFileNameIOS 와 1:1 동일: `parkinon_<soundId>.caf`.
//
// ⚠️ 미검증(설계서 PoC): Expo Push 가 iOS 에 임의 사운드 파일명을 APNs aps.sound 로
//   실제 전달하는지 새 빌드 후 실측 전까지 단정 불가. 안 울리면 APNs 직접 발송으로 전환.
function soundIdFromChannel(channelId: string): string | null {
  if (channelId === 'default') return null
  const m = channelId.match(/^parkinon_alarm_(.+)$/)
  return m ? m[1] : null
}
function soundForPlatform(platform: string | null | undefined, channelId: string): string {
  if (platform === 'ios') {
    const soundId = soundIdFromChannel(channelId)
    if (soundId) return `parkinon_${soundId}.caf`
  }
  return 'default'
}

async function sendPush(to: string, title: string, body: string, data: Record<string, unknown>, channelId = 'default', platform: string | null = null): Promise<boolean> {
  // iOS 커스텀음은 sound 문자열, Android 는 channelId 로 좌우(sound='default').
  const sound = soundForPlatform(platform, channelId)
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      sound,
      title,
      body,
      data,
      priority: 'high',
      channelId,
      // 디지털 바이오마커 MVP-A Phase 4 — 약효추적 알림 액션 버튼 '바로 측정하기'.
      // 본 함수는 effect_tracking_queue 전용이라 모든 푸시에 categoryId='effect_tracking' 부여.
      // 클라이언트(App.tsx)가 Notifications.setNotificationCategoryAsync('effect_tracking', ...)로
      // 'measure_now' 액션을 등록 → 시스템 알림 UI에 액션 버튼 노출.
      categoryId: 'effect_tracking',
    }),
  })
  const result = await res.json()
  const ok = result?.data?.status === 'ok'
  console.log('[process-queue sendPush]', JSON.stringify({ to: to.slice(0, 30), status: result?.data?.status, result }))
  return ok
}

Deno.serve(async (_req: Request) => {
  const now = new Date()

  // dose_slot_id가 있으면 dose_slots를 join해 label/track_sound_id를 동적으로 해석.
  // 구 데이터(dose_slot_id NULL)는 join이 null로 와서 meal_time fallback 경로 사용.
  const { data: pending } = await supabase
    .from('effect_tracking_queue')
    .select('*, dose_slot:dose_slots(label, time, track_sound_id, is_active, track_enabled)')
    .lte('send_at', now.toISOString())
    .is('sent_at', null)
    .limit(100)

  if (!pending?.length) {
    return new Response(JSON.stringify({ processed: 0 }), { headers: { 'Content-Type': 'application/json' } })
  }

  // 수신자 플랫폼 일괄 조회 (iOS 커스텀 사운드명 분기용). patient_id→'ios'|'android'|null.
  // effect_tracking_queue.patient_id 에는 FK embed 가 없어 별도 조회로 맵 구성.
  // 동시에 notification_enabled(전체 알림 마스터)도 조회 — 발송 직전 게이트용.
  const platformByPatient = new Map<string, string | null>()
  const notifEnabledByPatient = new Map<string, boolean>()
  const languageByPatient = new Map<string, string>()
  const patientIds = [...new Set((pending as any[]).map((p) => p.patient_id).filter(Boolean))]
  if (patientIds.length) {
    const { data: pusers } = await supabase
      .from('users')
      .select('id, push_platform, notification_enabled, language')
      .in('id', patientIds)
    for (const u of pusers ?? []) {
      platformByPatient.set((u as any).id, (u as any).push_platform ?? null)
      notifEnabledByPatient.set((u as any).id, (u as any).notification_enabled !== false)
      languageByPatient.set((u as any).id, (u as any).language ?? 'ko')
    }
  }

  let processed = 0

  for (const item of pending) {
    // Atomic claim: sent_at을 먼저 선점해 동시 실행 시 중복 처리 방지
    const { data: claimed } = await supabase
      .from('effect_tracking_queue')
      .update({ sent_at: now.toISOString() })
      .eq('id', item.id)
      .is('sent_at', null)
      .select('id')

    if (!claimed || claimed.length === 0) {
      console.log('[process-queue] 이미 처리된 항목 건너뜀:', item.id)
      continue
    }

    // dose_slot 유효성 가드 (방어선 2):
    //   dose_slot_id 가 연결된 약효추적 큐인데, 그 슬롯이
    //     - 비활성(is_active=false, soft delete) 이거나
    //     - 추적 OFF(track_enabled=false) 이거나
    //     - 슬롯이 더 이상 존재하지 않으면(join null)
    //   발송하지 않는다. DB 트리거가 비활성화 시점에 미발송 큐를 정리하지만,
    //   타이밍/누락 대비 이중 방어. 이미 위에서 sent_at 을 선점(claim)했으므로
    //   여기서 continue 하면 큐 항목은 발송완료(소비)로 마크된 채 남아
    //   다음 크론에서 다시 뽑히지 않는다(무한 재시도 방지).
    //   dose_slot_id 가 없는 legacy(meal_time) 큐는 이 가드의 영향을 받지 않는다.
    if (item.dose_slot_id) {
      const guardSlot = Array.isArray(item.dose_slot) ? (item.dose_slot[0] ?? null) : (item.dose_slot ?? null)
      if (!guardSlot || guardSlot.is_active === false || guardSlot.track_enabled === false) {
        console.log('[process-queue] 비활성/추적OFF/삭제 슬롯 — 발송 스킵(sent_at 유지):', item.id, item.dose_slot_id)
        continue
      }
    }

    // 전체 알림 마스터 게이트: 환자가 전체 알림 OFF면 약효추적 푸시를 보내지 않는다.
    // 이미 위에서 sent_at 을 선점(claim)했으므로, 여기서 그냥 continue 하면
    // 해당 큐 항목은 sent_at 마킹된 채로 남아 무한 재시도되지 않는다(스킵=발송완료 처리).
    if (notifEnabledByPatient.get(item.patient_id) === false) {
      console.log('[process-queue] 전체 알림 OFF — 발송 스킵(sent_at 유지):', item.id)
      continue
    }

    // dose_slot 조인은 단일 객체 또는 배열로 올 수 있어 정규화.
    const doseSlot = Array.isArray(item.dose_slot) ? (item.dose_slot[0] ?? null) : (item.dose_slot ?? null)
    const isEn = languageByPatient.get(item.patient_id) === 'en'
    const isImmediate = item.interval_minutes === 0
    const titleText = isEn ? '😊 How do you feel?' : '😊 몸 상태는 어때요?'
    let bodyText: string
    if (isEn) {
      const headEn = resolvePeriodHeadEn(doseSlot, item.meal_time)
      const intervalLabelEn = getIntervalLabelEn(item.interval_minutes)
      bodyText = headEn
        ? (isImmediate
            ? `${headEn} — log your body state right after taking your medication.`
            : `${headEn} — log your body state ${intervalLabelEn} taking your medication.`)
        : (isImmediate
            ? 'Log your body state right after taking your medication.'
            : `Log your body state ${intervalLabelEn} taking your medication.`)
    } else {
      const head = resolvePeriodHead(doseSlot, item.meal_time) // "저녁 6:00" 또는 ''
      // 간격이 0(복용 직후)이면 "복용약 드신 직후", 그 외(분/시간)는 "복용약의 {N분 후}".
      const intervalLabel = getIntervalLabel(item.interval_minutes) // "30분 후" 등 (0이면 미사용)
      bodyText = head
        ? (isImmediate
            ? `${head} 복용약 드신 직후 몸 상태를 기록해보세요.`
            : `${head} 복용약의 ${intervalLabel} 몸 상태를 기록해보세요.`)
        : (isImmediate
            ? `복용약 드신 직후 몸 상태를 기록해보세요.`
            : `복용약의 ${intervalLabel} 몸 상태를 기록해보세요.`)
    }

    // 목소리(채널) 결정:
    //  1) 큐에 직접 지정된 sound_id(구 경로) 우선
    //  2) 없으면 신규 경로: dose_slot.track_sound_id
    //  3) 둘 다 없으면 시스템 기본음('default')
    const soundId = item.sound_id ?? doseSlot?.track_sound_id ?? null
    const channelId = soundId ? `parkinon_alarm_${soundId}` : 'default'
    const platform = platformByPatient.get(item.patient_id) ?? null
    const ok = await sendPush(
      item.push_token,
      titleText,
      bodyText,
      { type: 'effect_tracking', minutes: item.interval_minutes, meal_time: item.meal_time ?? null, doseSlotId: item.dose_slot_id ?? null, med_log_id: item.med_log_id ?? null },
      channelId,
      platform,
    )

    if (ok) {
      await supabase.from('notification_logs').insert({
        user_id: item.patient_id,
        type: 'effect_tracking',
        title: titleText,
        body: bodyText,
        data: { type: 'effect_tracking', minutes: item.interval_minutes, meal_time: item.meal_time ?? null, doseSlotId: item.dose_slot_id ?? null, med_log_id: item.med_log_id ?? null },
        read_at: null,
      })
      processed++
    } else {
      // 푸시 실패 → sent_at 초기화해 재시도 가능하게
      await supabase
        .from('effect_tracking_queue')
        .update({ sent_at: null })
        .eq('id', item.id)
      console.error('[process-queue] push 실패 — sent_at 초기화, 재시도 대기:', item.id)
    }
  }

  return new Response(JSON.stringify({ processed }), { headers: { 'Content-Type': 'application/json' } })
})

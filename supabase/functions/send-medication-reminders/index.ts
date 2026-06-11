import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// legacy 4슬롯 라벨 fallback. dose_slot.label이 있으면 그 값을 우선 사용.
const MEAL_LABELS: Record<string, string> = {
  morning: '아침', lunch: '점심', dinner: '저녁', bedtime: '취침',
}

/**
 * get_meds_at_time RPC가 반환하는 1행.
 * - legacy 행: meal_time(슬롯키) 채워짐, dose_slot_id/label NULL.
 * - 신규(dose_slot) 행: dose_slot_id/label 채워짐. meal_time은 표준 4라벨이면
 *   호환용 슬롯키, 비표준 라벨이면 NULL.
 */
interface MedRow {
  patient_id: string
  meal_time: string | null
  dose_slot_id: string | null
  label: string | null
  time: string | null
}

/**
 * 한 번 알릴 단위(복용 슬롯). legacy/신규를 통일해 다룬다.
 * - key: 중복제거·prefs 조회용 안정 키 (dose_slot_id 우선, 없으면 meal_time)
 * - mealTime: 구버전 prefs/sound prefs 키 & 푸시 data.mealTime (없으면 null)
 * - doseSlotId: 신규 식별자 (없으면 null)
 * - displayLabel: 표시용 한글 라벨
 */
interface DoseTarget {
  key: string
  mealTime: string | null
  doseSlotId: string | null
  displayLabel: string
}

function toDoseTarget(row: MedRow): DoseTarget | null {
  const mealTime = row.meal_time ?? null
  const doseSlotId = row.dose_slot_id ?? null
  // 표시 라벨: dose_slot.label 우선 → meal_time MEAL_LABELS fallback → '약'
  const displayLabel =
    (row.label && row.label.trim()) ||
    (mealTime ? MEAL_LABELS[mealTime] : '') ||
    '약'
  // 안정 키: dose_slot_id 우선, 없으면 meal_time. 둘 다 없으면 식별 불가 → skip.
  const key = doseSlotId ?? mealTime
  if (!key) return null
  return { key, mealTime, doseSlotId, displayLabel }
}

/** 환자별 DoseTarget 목록을 RPC 행에서 구성 (key 기준 중복제거). */
function groupTargets(rows: MedRow[] | null | undefined): Map<string, DoseTarget[]> {
  const out = new Map<string, Map<string, DoseTarget>>()
  for (const row of rows ?? []) {
    const t = toDoseTarget(row)
    if (!t) continue
    if (!out.has(row.patient_id)) out.set(row.patient_id, new Map())
    out.get(row.patient_id)!.set(t.key, t)
  }
  const result = new Map<string, DoseTarget[]>()
  for (const [pid, m] of out.entries()) result.set(pid, [...m.values()])
  return result
}

async function sendPush(
  to: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
  channelId = 'default',
) {
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      sound: 'default',
      title,
      body,
      data,
      priority: 'high',
      channelId,
    }),
  })
  const result = await res.json()
  console.log('[sendPush]', JSON.stringify({ to: to.slice(0, 30), title, channelId, status: res.status, result }))
}

/**
 * 수신자의 알림음 설정 → Android 채널 ID 결정.
 * recorded면 클라가 프로비저닝해 둔 `parkinon_alarm_<soundId>` 채널, 아니면 'default'.
 * (채널 규칙은 클라 src/lib/alarmSound.ts와 동일해야 함)
 */
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

function subtractMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = h * 60 + m - minutes
  const safeTotal = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(safeTotal / 60)).padStart(2, '0')}:${String(safeTotal % 60).padStart(2, '0')}`
}

async function logNotification(userId: string, type: string, title: string, body: string, data: Record<string, unknown>) {
  await supabase.from('notification_logs').insert({
    user_id: userId,
    type,
    title,
    body,
    data,
    read_at: null,
  })
}

/**
 * 오늘 이 복용 슬롯을 이미 복용했는지.
 * 구버전(meal_time) 기록과 신버전(dose_slot_id) 기록 둘 중 하나라도 있으면 true.
 * → 구버전 앱이 meal_time으로 기록해도, 신버전이 dose_slot_id로 기록해도 인식.
 */
async function hasTakenMed(
  patientId: string,
  target: DoseTarget,
  today: string,
): Promise<boolean> {
  const start = `${today}T00:00:00+09:00`
  const end = `${today}T23:59:59+09:00`

  // 신규 경로: dose_slot_id 기록 확인
  if (target.doseSlotId) {
    const { data: bySlot } = await supabase
      .from('med_logs')
      .select('id')
      .eq('patient_id', patientId)
      .eq('dose_slot_id', target.doseSlotId)
      .gte('taken_at', start)
      .lte('taken_at', end)
      .limit(1)
    if (bySlot?.length) return true
  }

  // 구 경로: meal_time 기록 확인 (구버전 앱 호환 — 단 하나도 깨지면 안 됨)
  if (target.mealTime) {
    const { data: bySlotKey } = await supabase
      .from('med_logs')
      .select('id')
      .eq('patient_id', patientId)
      .eq('meal_time', target.mealTime)
      .gte('taken_at', start)
      .lte('taken_at', end)
      .limit(1)
    if (bySlotKey?.length) return true
  }

  return false
}

async function sendCaregiverMissed(
  patientId: string,
  patientGroupId: string,
  target: DoseTarget,
) {
  const { data: caregivers } = await supabase
    .from('patient_group_members')
    .select('user_id')
    .eq('group_id', patientGroupId)
    .eq('role', 'caregiver')

  if (!caregivers?.length) return

  const { data: patientUser } = await supabase
    .from('users')
    .select('name')
    .eq('id', patientId)
    .single()
  const patientName = patientUser?.name?.trim()
  const subject = patientName ? `${patientName}님` : '환자분'

  const { data: caregiverUsers } = await supabase
    .from('users')
    .select('id, push_token, caregiver_notif_prefs')
    .in('id', caregivers.map((c: any) => c.user_id))
    .not('push_token', 'is', null)

  for (const cu of caregiverUsers ?? []) {
    if (!cu.push_token) continue
    const prefs = (cu.caregiver_notif_prefs ?? {}) as Record<string, boolean>
    if (prefs.med_missed === false) continue
    const channelId = await resolveAlarmChannel(cu.id)
    await sendPush(
      cu.push_token,
      '⚠️ 약을 안 드셨어요',
      `${subject}이 ${target.displayLabel} 약을 아직 안 드셨어요.`,
      { type: 'caregiver_missed_med', mealTime: target.mealTime, doseSlotId: target.doseSlotId },
      channelId,
    )
  }
}

/**
 * 한 환자의 복용 슬롯들에 대해 알림 발송.
 * phase: 정시(reminder) / 1차(first) / 2차(second).
 * 구버전과 동일하게 prefs[mealTime]===false면 skip, 이미 복용이면 skip.
 * 신규 dose_slot 행은 mealTime이 없을 수 있는데, 이 경우 prefs 게이트는
 * dose_slot.remind_enabled(RPC가 이미 필터)로 대체되므로 통과시킨다.
 */
function isMuted(prefs: Record<string, boolean>, target: DoseTarget): boolean {
  // 신규 dose_slot 타겟: get_meds_at_time 이 이미 dose_slots.remind_enabled 로 필터함.
  //   → legacy med_time_notif_prefs[mealTime] 로 추가 차단하면, 새 토글(remind_enabled)을
  //     켜도 옛 prefs(예: morning:false)가 남아 알림이 막히는 desync 버그가 생긴다.
  //   → dose_slot 타겟은 remind_enabled 를 단일 진실로 삼고 추가 차단하지 않는다.
  if (target.doseSlotId) return false
  // 구 경로(legacy, doseSlotId 없음): meal_time prefs로 끈 경우만 존중
  if (target.mealTime && prefs[target.mealTime] === false) return true
  return false
}

function channelFor(soundPrefs: Record<string, string | null>, target: DoseTarget): string {
  // 구 경로: med_time_sound_prefs[mealTime]. 신규 슬롯은 mealTime 없으면 default.
  // (dose_slot.remind_sound_id 기반 채널은 4단계 클라 전환과 함께 도입 예정)
  const slotSoundId = target.mealTime ? soundPrefs[target.mealTime] : null
  return slotSoundId ? `parkinon_alarm_${slotSoundId}` : 'default'
}

/**
 * 미복용 알림 전용 알림음 우선 적용.
 * missedSoundId(1차=first_sound_id / 2차=second_sound_id)가 있으면 그 채널,
 * 없으면 기존 동작(med_time_sound_prefs 따라가기 = channelFor)으로 fallback.
 */
function missedChannelFor(
  missedSoundId: string | null,
  soundPrefs: Record<string, string | null>,
  target: DoseTarget,
): string {
  if (missedSoundId) return `parkinon_alarm_${missedSoundId}`
  return channelFor(soundPrefs, target)
}

/** 환자의 미복용 전용 알림음 설정 1회 조회 (없으면 둘 다 null) */
async function getMissedSoundPrefs(
  userId: string,
): Promise<{ first: string | null; second: string | null }> {
  const { data } = await supabase
    .from('missed_med_sound_prefs')
    .select('first_sound_id, second_sound_id')
    .eq('user_id', userId)
    .maybeSingle()
  return {
    first: (data as any)?.first_sound_id ?? null,
    second: (data as any)?.second_sound_id ?? null,
  }
}

Deno.serve(async (_req: Request) => {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const hh = String(kstNow.getHours()).padStart(2, '0')
  const mm = String(kstNow.getMinutes()).padStart(2, '0')
  const currentTime = `${hh}:${mm}`
  const time10 = subtractMinutes(currentTime, 10)
  const time20 = subtractMinutes(currentTime, 20)
  const today = kstNow.toISOString().split('T')[0]

  let sent = 0

  // ── 1. 정시 알림 ──────────────────────────────────────────────────
  const { data: matchedMeds } = await supabase.rpc('get_meds_at_time', { target_time: currentTime })

  const onTime = groupTargets(matchedMeds as MedRow[] | null)
  for (const [patientId, targets] of onTime.entries()) {
    const { data: patient } = await supabase
      .from('users')
      .select('push_token, notification_enabled, med_time_notif_prefs, med_time_sound_prefs, patient_group_id')
      .eq('id', patientId)
      .single()

    if (!patient?.push_token || !patient.notification_enabled) continue

    const prefs = (patient.med_time_notif_prefs ?? {}) as Record<string, boolean>
    const soundPrefs = (patient.med_time_sound_prefs ?? {}) as Record<string, string | null>

    for (const target of targets) {
      if (isMuted(prefs, target)) continue
      if (await hasTakenMed(patientId, target, today)) continue

      const channelId = channelFor(soundPrefs, target)
      const data = { type: 'medication_reminder', mealTime: target.mealTime, doseSlotId: target.doseSlotId }

      await sendPush(
        patient.push_token,
        '💊 약 드실 시간이에요',
        `${target.displayLabel} 약을 드실 시간이에요.`,
        data,
        channelId,
      )
      await logNotification(patientId, 'medication_reminder', '💊 약 드실 시간이에요', `${target.displayLabel} 약을 드실 시간이에요.`, data)
      sent++
    }
  }

  // ── 2. 1차 미복용 알림 (+10분) — 환자에게만 ───────────────────────
  const { data: meds10 } = await supabase.rpc('get_meds_at_time', { target_time: time10 })

  const first = groupTargets(meds10 as MedRow[] | null)
  for (const [patientId, targets] of first.entries()) {
    const { data: patient } = await supabase
      .from('users')
      .select('push_token, notification_enabled, med_time_notif_prefs, med_time_sound_prefs, patient_group_id')
      .eq('id', patientId)
      .single()

    if (!patient?.push_token || !patient.notification_enabled) continue

    const prefs = (patient.med_time_notif_prefs ?? {}) as Record<string, boolean>
    const soundPrefs = (patient.med_time_sound_prefs ?? {}) as Record<string, string | null>
    // 환자가 1차 미복용 알림을 끈 경우 발송 안 함
    if (prefs.missed_first === false) continue
    // 미복용 1차 전용 알림음 (없으면 med_time_sound_prefs로 fallback)
    const missedSounds = await getMissedSoundPrefs(patientId)

    for (const target of targets) {
      if (isMuted(prefs, target)) continue
      if (await hasTakenMed(patientId, target, today)) continue

      const channelId = missedChannelFor(missedSounds.first, soundPrefs, target)
      const data = { type: 'missed_medication_first', mealTime: target.mealTime, doseSlotId: target.doseSlotId }

      await sendPush(
        patient.push_token,
        '💊 약을 아직 안 드셨어요',
        `${target.displayLabel} 약을 아직 드시지 않으셨어요.`,
        data,
        channelId,
      )
      await logNotification(patientId, 'missed_medication', '💊 약을 아직 안 드셨어요', `${target.displayLabel} 약을 아직 드시지 않으셨어요.`, data)
      sent++
    }
  }

  // ── 3. 2차 미복용 알림 (+20분) — 환자 + 보호자 ───────────────────
  const { data: meds20 } = await supabase.rpc('get_meds_at_time', { target_time: time20 })

  const second = groupTargets(meds20 as MedRow[] | null)
  for (const [patientId, targets] of second.entries()) {
    const { data: patient } = await supabase
      .from('users')
      .select('push_token, notification_enabled, med_time_notif_prefs, med_time_sound_prefs, patient_group_id')
      .eq('id', patientId)
      .single()

    if (!patient?.notification_enabled) continue

    const prefs = (patient.med_time_notif_prefs ?? {}) as Record<string, boolean>
    const soundPrefs = (patient.med_time_sound_prefs ?? {}) as Record<string, string | null>
    // 미복용 2차 전용 알림음 (없으면 med_time_sound_prefs로 fallback) — 환자 본인만 적용
    const missedSounds = await getMissedSoundPrefs(patientId)

    for (const target of targets) {
      if (isMuted(prefs, target)) continue
      if (await hasTakenMed(patientId, target, today)) continue

      const channelId = missedChannelFor(missedSounds.second, soundPrefs, target)

      // 환자에게 2차 알림 (환자가 2차 미복용 알림을 끈 경우 보내지 않음 — 보호자 알림은 아래에서 독립 처리)
      if (patient.push_token && prefs.missed_second !== false) {
        const data = { type: 'missed_medication_second', mealTime: target.mealTime, doseSlotId: target.doseSlotId }
        await sendPush(
          patient.push_token,
          '💊 약을 안 드셨어요',
          `${target.displayLabel} 약을 아직 안 드셨어요.`,
          data,
          channelId,
        )
        await logNotification(patientId, 'missed_medication', '💊 약을 안 드셨어요', `${target.displayLabel} 약을 아직 안 드셨어요.`, data)
        sent++
      }

      // 보호자에게 알림
      if (patient.patient_group_id) {
        await sendCaregiverMissed(patientId, patient.patient_group_id, target)
      }
    }
  }

  // ── 4. 운동 알림 ────────────────────────────────────────────────
  const { data: allPatients } = await supabase
    .from('users')
    .select('id, push_token, notification_enabled, exercise_notif_prefs')
    .eq('role', 'patient')
    .eq('notification_enabled', true)
    .not('push_token', 'is', null)

  for (const patient of allPatients ?? []) {
    if (!patient.push_token) continue
    const prefs = (patient.exercise_notif_prefs ?? []) as Array<{
      id: string; ampm: string; hour: number; minute: number; enabled: boolean; soundId?: string | null
    }>
    for (const pref of prefs) {
      if (!pref.enabled) continue
      // ampm + hour → 24시간 KST HH:MM 변환
      let h = pref.hour
      if (pref.ampm === '오후' && h !== 12) h += 12
      if (pref.ampm === '오전' && h === 12) h = 0
      const target = `${String(h).padStart(2, '0')}:${String(pref.minute).padStart(2, '0')}`
      if (target !== currentTime) continue
      // 이 운동 알림 항목에 지정된 목소리(soundId). 없으면("기본 목소리") 휴대폰 시스템 기본음('default').
      const exerciseChannelId = pref.soundId ? `parkinon_alarm_${pref.soundId}` : 'default'
      await sendPush(
        patient.push_token,
        '🏃 운동할 시간이에요!',
        '오늘 운동 기록을 남겨보세요.',
        { type: 'exercise_reminder' },
        exerciseChannelId,
      )
      await logNotification(patient.id, 'exercise_reminder', '🏃 운동할 시간이에요!', '오늘 운동 기록을 남겨보세요.', { type: 'exercise_reminder' })
      sent++
    }
  }

  return new Response(JSON.stringify({ sent, time: currentTime, time10, time20 }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

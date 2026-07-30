import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveLang, t, periodKeyFor, type Lang, slotLabel } from '../_shared/i18n.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// legacy 4슬롯 라벨 fallback. dose_slot.label이 있으면 그 값을 우선 사용.

/**
 * 'HH:MM[:SS]' → 12시간제 'H:MM' (오전/오후 없이). 푸시 문구의 시각 표기용.
 * 시간대 단어(아침/저녁 등)가 이미 오전/오후를 표현하므로 중복 방지로 접두사 없음.
 * 예: '18:00'→'6:00', '08:00'→'8:00', '12:00'→'12:00', '00:00'→'12:00'(자정), '15:00'→'3:00'.
 * 분은 그대로(:00, :30 등). 파싱 실패 시 빈 문자열(호출처가 시간대만으로 폴백).
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

/**
 * get_meds_due RPC(Phase1-S3, tz-aware — 구 get_meds_at_time 대체)가 반환하는 1행.
 * - legacy 행: meal_time(슬롯키) 채워짐, dose_slot_id/label NULL.
 * - 신규(dose_slot) 행: dose_slot_id/label 채워짐. meal_time은 표준 4라벨이면
 *   호환용 슬롯키, 비표준 라벨이면 NULL.
 * - local_today: 그 환자의 users.timezone 기준 "오늘"(YYYY-MM-DD). hasTakenMed의
 *   하루 경계 산출에 사용(전역 KST today 제거).
 */
interface MedRow {
  patient_id: string
  meal_time: string | null
  dose_slot_id: string | null
  label: string | null
  time: string | null
  local_today: string | null
}

/**
 * 주어진 IANA tz에서 dateStr(YYYY-MM-DD)의 00:00:00~23:59:59.999 벽시계 경계를
 * UTC ISO 문자열로 변환(date-fns-tz 의 zonedTimeToUtc 와 동일한 왕복-보정 기법).
 * Asia/Seoul(DST 없음)에서는 기존 `${today}T00:00:00+09:00` ~ `T23:59:59+09:00` 와
 * 정확히 동일한 순간을 산출한다(회귀 0, 직접 계산으로 검증됨).
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
  // 기존 `${today}T23:59:59+09:00`(초 단위, ms 없음)와 비트 동일하도록 -1000ms(정확히 23:59:59.000).
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1000)
  return { start: start.toISOString(), end: end.toISOString() }
}

/** 환자 현지 시각 'HH:MM'(24h). 운동 알림 시각 비교용(전역 KST currentTime 대체). */
function nowHHMMInTz(tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' })
  const parts = fmt.formatToParts(new Date()).reduce((acc, p) => {
    acc[p.type] = p.value
    return acc
  }, {} as Record<string, string>)
  const hour = parts.hour === '24' ? '00' : parts.hour
  return `${hour}:${parts.minute}`
}

/**
 * 한 번 알릴 단위(복용 슬롯). legacy/신규를 통일해 다룬다.
 * - key: 중복제거·prefs 조회용 안정 키 (dose_slot_id 우선, 없으면 meal_time)
 * - mealTime: 구버전 prefs/sound prefs 키 & 푸시 data.mealTime (없으면 null)
 * - doseSlotId: 신규 식별자 (없으면 null)
 */
interface DoseTarget {
  key: string
  mealTime: string | null
  doseSlotId: string | null
  /** 슬롯 시각 'HH:MM'(24h, 없으면 null). 푸시 문구에 12시간제 H:MM로 표기. */
  time: string | null
  /** 이 환자의 tz 기준 "오늘"(YYYY-MM-DD). hasTakenMed 하루 경계 계산용. */
  localToday: string
}

function toDoseTarget(row: MedRow): DoseTarget | null {
  // meal_time 은 RPC 가 legacy_key(언어 무관)로 산출한 표준 슬롯 키다.
  // 예전엔 label('아침')을 파싱했는데, 프랑스어/일본어 사용자의 슬롯은 label 이
  // 한글이 아니라서 시간대 판정이 통째로 빠졌다. 키를 단일 진실로 쓴다.
  const mealTime = row.meal_time ?? null
  const doseSlotId = row.dose_slot_id ?? null
  const key = doseSlotId ?? mealTime
  if (!key) return null
  return {
    key, mealTime, doseSlotId,
    time: row.time ?? null,
    localToday: row.local_today ?? new Date().toISOString().split('T')[0],
  }
}

// ─── 시간대별 푸시 문구 (합의 문구 — AGENT_06_notification.md §알림 문구 목록) ─────
// {시간대} = periodLabel(아침/점심/오후/저녁/밤/새벽 또는 표준 라벨).
// {시각} = 12시간제 H:MM(오전/오후 없이). 시간대 단어가 오전/오후를 표현하므로 접두사 없음.
//   포맷 A(오너 합의·변경 금지): "{시간대} {시각} 약 복용 시간이에요."
//   예: 아침08:00→"아침 8:00 …", 저녁18:00→"저녁 6:00 …", 오후15:00→"오후 3:00 …".
// periodLabel/clock 둘 다 없으면 시간대·시각 없는 자연스러운 문구로 폴백.

/** periodLabel + clock(12h H:MM) → "{시간대} {시각}" (한쪽만 있으면 그것만, 둘 다 없으면 ''). */
function periodWithTime(periodLabel: string, clock: string): string {
  return [periodLabel, clock].filter(Boolean).join(' ')
}

/**
 * 알림 body 생성 — 언어별 문구는 _shared/i18n.ts 한 곳에만 있다.
 * periodLabel(시간대) + clock(시각) 을 합쳐 {{when}} 에 넣는다. 둘 다 없으면 시간대 없는 문구로 폴백.
 */
function bodyFor(
  lang: Lang,
  kind: 'reminder' | 'missed' | 'caregiverMissed',
  periodLabel: string,
  clock: string,
  subject?: string,
): string {
  const when = periodWithTime(periodLabel, clock)
  const keys = {
    reminder: ['med.time.body', 'med.time.bodyNoTime'],
    missed: ['med.missed.body', 'med.missed.bodyNoTime'],
    caregiverMissed: ['med.missed.caregiverBody', 'med.missed.caregiverBodyNoTime'],
  }[kind]
  return t(lang, when ? keys[0] : keys[1], { when, subject: subject ?? '' })
}

/**
 * 언어별 {시간대} 라벨 — mealTime 키(언어 무관) 우선, 없으면 시각 기반 period 키.
 * ko/en 이분법(periodLabel/periodLabelEn)이던 것을 4개 언어로 — fr/ja 사용자 문장에
 * 영어 시간대가 섞이지 않는다.
 */
function periodLabelLoc(lang: Lang, target: DoseTarget): string {
  // DB 의 한글 라벨을 보지 않는다 — legacy_key(mealTime) 와 시각만으로 만든다.
  return slotLabel(lang, target.mealTime, target.time)
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

// ─── iOS 커스텀 알림음(가족 목소리) ──────────────────────────────────────────
// Android 는 알림 채널(channelId=`parkinon_alarm_<soundId>`)로 커스텀음을 울리지만,
// iOS 는 채널 개념이 없고 Library/Sounds/<파일명>.caf 에 설치된 사운드를
// 푸시 payload 의 sound 문자열로 지정해야 한다. 파일명 규칙은 클라(src/lib/alarmSound.ts
// alarmSoundFileNameIOS)와 1:1 동일: `parkinon_<soundId>.caf`.
//
// ⚠️ 미검증(설계서 PoC): Expo Push 가 iOS 에 임의 사운드 파일명을 APNs aps.sound 문자열로
//   실제 전달하는지는 새 빌드(네이티브 모듈 활성) 후 실측 전까지 단정 불가.
//   일반 파일명은 Expo 가 그대로 넘기는 것으로 알려져 있으나, 빌드 후 안 울리면
//   APNs 직접 발송(aps.sound 직접 세팅)으로 전환할 것(이번 범위 밖, 서버라 재빌드 불필요).

/** Android channelId(`parkinon_alarm_<soundId>`) → 그 soundId 만 추출(없으면 null). */
function soundIdFromChannel(channelId: string): string | null {
  if (channelId === 'default') return null
  const m = channelId.match(/^parkinon_alarm_(.+)$/)
  return m ? m[1] : null
}

/** soundId → iOS 알림음 파일명(클라 alarmSoundFileNameIOS 와 동일 규칙). */
function alarmSoundFileNameIOS(soundId: string): string {
  return `parkinon_${soundId}.caf`
}

/** 프리셋 채널(`parkinon_preset_<fileId>`) → fileId (아니면 null). */
function presetFileIdFromChannel(channelId: string): string | null {
  const m = channelId.match(/^parkinon_preset_(.+)$/)
  return m ? m[1] : null
}

/**
 * 저장된 알림음 id → Android channelId.
 * - 'preset:<fileId>' → 번들 프리셋 채널 `parkinon_preset_<fileId>` (클라 presetChannelIdAndroid 와 동일)
 * - 녹음 uuid → `parkinon_alarm_<uuid>`
 * - null(시스템 기본음) → 'default'
 */
function channelForStoredSound(soundId: string | null | undefined): string {
  if (!soundId) return 'default'
  if (soundId.startsWith('preset:')) return `parkinon_preset_${soundId.slice('preset:'.length)}`
  return `parkinon_alarm_${soundId}`
}

/**
 * Android 용으로 계산한 channelId 를 받아, 수신자 플랫폼에 맞는 Expo Push 의 sound 값을 돌려준다.
 * - iOS + 프리셋 채널 → `<fileId>.caf` (번들, 클라 presetSoundFileNameIOS 와 동일)
 * - iOS + 녹음 soundId 있음 → `parkinon_<soundId>.caf`
 * - 그 외(iOS 기본음, Android) → 'default' (Android 는 channelId 로 커스텀음 처리)
 */
function soundForPlatform(platform: string | null | undefined, channelId: string): string {
  if (platform === 'ios') {
    const presetFile = presetFileIdFromChannel(channelId)
    if (presetFile) return `${presetFile}.caf`
    const soundId = soundIdFromChannel(channelId)
    if (soundId) return alarmSoundFileNameIOS(soundId)
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
  // 수신자별 sound 분기: iOS 커스텀음은 sound 문자열, Android 는 channelId 가 좌우(sound='default').
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
    }),
  })
  const result = await res.json()
  console.log('[sendPush]', JSON.stringify({ to: to.slice(0, 30), title, channelId, sound, platform, status: res.status, result }))
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
    return channelForStoredSound(data.custom_sound_id)
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
 * "오늘" 하루 경계는 이 환자의 tz(target.localToday + tz)로 산출(Phase1-S3, 전역 KST today 제거).
 * tz='Asia/Seoul'이면 기존 `${today}T00:00:00+09:00`~`T23:59:59+09:00`와 동일 순간(회귀 0).
 */
async function hasTakenMed(
  patientId: string,
  target: DoseTarget,
  tz: string,
): Promise<boolean> {
  const { start, end } = localDayRangeUtc(target.localToday, tz)

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
  // 보호자마다 언어가 다르다 — 하나로 만들어 두면 ko/en 이분법이 되어 fr·ja 가 영어를 받는다.
  const subjectFor = (l: Lang) => patientName
    ? t(l, 'patient.honorific', { name: patientName })
    : t(l, 'patient.fallbackName')

  const { data: caregiverUsers } = await supabase
    .from('users')
    .select('id, push_token, push_platform, caregiver_notif_prefs, language')
    .in('id', caregivers.map((c: any) => c.user_id))
    .not('push_token', 'is', null)

  for (const cu of caregiverUsers ?? []) {
    if (!cu.push_token) continue
    const prefs = (cu.caregiver_notif_prefs ?? {}) as Record<string, boolean>
    if (prefs.med_missed === false) continue
    const channelId = await resolveAlarmChannel(cu.id)
    const lang = resolveLang((cu as any).language)
    const title = t(lang, 'med.missed.title')
    const body = bodyFor(
      lang, 'caregiverMissed',
      periodLabelLoc(lang, target),
      formatClockTime(target.time),
      subjectFor(lang),
    )
    const data = { type: 'caregiver_missed_med', mealTime: target.mealTime, doseSlotId: target.doseSlotId }
    await sendPush(
      cu.push_token,
      title,
      body,
      data,
      channelId,
      (cu as any).push_platform ?? null,
    )
    await logNotification(cu.id, 'caregiver_missed_med', title, body, data)
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
  // 신규 dose_slot 타겟: get_meds_due 가 이미 dose_slots.remind_enabled 로 필터함.
  //   → legacy med_time_notif_prefs[mealTime] 로 추가 차단하면, 새 토글(remind_enabled)을
  //     켜도 옛 prefs(예: morning:false)가 남아 알림이 막히는 desync 버그가 생긴다.
  //   → dose_slot 타겟은 remind_enabled 를 단일 진실로 삼고 추가 차단하지 않는다.
  if (target.doseSlotId) return false
  // 구 경로(legacy, doseSlotId 없음): meal_time prefs로 끈 경우만 존중
  if (target.mealTime && prefs[target.mealTime] === false) return true
  return false
}

function channelFor(soundPrefs: Record<string, string | null>, target: DoseTarget): string {
  // 구 경로(legacy, doseSlotId 없음): med_time_sound_prefs[mealTime].
  const slotSoundId = target.mealTime ? soundPrefs[target.mealTime] : null
  return slotSoundId ? `parkinon_alarm_${slotSoundId}` : 'default'
}

/** dose_slot 별 복약/약효추적 알림음·방식. 환자당 1회 조회해 target 해석에 사용. */
type SlotAlarm = { remind: string | null; remindMode: string; track: string | null; trackMode: string }
async function getDoseSlotAlarms(patientId: string): Promise<Map<string, SlotAlarm>> {
  const map = new Map<string, SlotAlarm>()
  const { data } = await supabase
    .from('dose_slots')
    .select('id, remind_sound_id, remind_alarm_mode, track_sound_id, track_alarm_mode')
    .eq('patient_id', patientId)
    .eq('is_active', true)
  for (const r of (data as any[]) ?? []) {
    map.set(r.id, {
      remind: r.remind_sound_id ?? null,
      remindMode: r.remind_alarm_mode ?? 'basic',
      track: r.track_sound_id ?? null,
      trackMode: r.track_alarm_mode ?? 'basic',
    })
  }
  return map
}

/**
 * 정시 복약 알림의 채널·방식 결정.
 * - dose_slot 타겟이면 dose_slots.remind_sound_id(녹음/프리셋/기본음)를 단일 진실로 사용.
 * - legacy 타겟(doseSlotId 없음)이면 기존 med_time_sound_prefs(channelFor) 폴백.
 */
function remindChannelAndMode(
  target: DoseTarget,
  slotAlarms: Map<string, SlotAlarm>,
  soundPrefs: Record<string, string | null>,
): { channelId: string; alarmMode: string } {
  if (target.doseSlotId && slotAlarms.has(target.doseSlotId)) {
    const s = slotAlarms.get(target.doseSlotId)!
    // 명시 선택(녹음/프리셋)이 있으면 그것을 사용. 없으면(null=미설정/시스템기본음)
    //   기존 legacy 소리를 유지(구 사용자 회귀 방지). 방식(mode)은 슬롯 값을 그대로.
    if (s.remind) return { channelId: channelForStoredSound(s.remind), alarmMode: s.remindMode }
    return { channelId: channelFor(soundPrefs, target), alarmMode: s.remindMode }
  }
  return { channelId: channelFor(soundPrefs, target), alarmMode: 'basic' }
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
  if (missedSoundId) return channelForStoredSound(missedSoundId)
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
  // 진단/응답 로그 전용 참고값(KST 기준) — 실제 매칭은 이제 get_meds_due(offset)가
  // 각 환자의 tz로 직접 계산하므로 이 값들은 어떤 발송 로직도 좌우하지 않는다.
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const hh = String(kstNow.getHours()).padStart(2, '0')
  const mm = String(kstNow.getMinutes()).padStart(2, '0')
  const currentTime = `${hh}:${mm}`
  const time10 = subtractMinutes(currentTime, 10)
  const time20 = subtractMinutes(currentTime, 20)

  let sent = 0

  // ── 1. 정시 알림 ──────────────────────────────────────────────────
  const { data: matchedMeds } = await supabase.rpc('get_meds_due', { offset_minutes: 0 })

  const onTime = groupTargets(matchedMeds as MedRow[] | null)
  for (const [patientId, targets] of onTime.entries()) {
    const { data: patient } = await supabase
      .from('users')
      .select('push_token, push_platform, notification_enabled, med_time_notif_prefs, med_time_sound_prefs, patient_group_id, language, timezone')
      .eq('id', patientId)
      .single()

    if (!patient?.push_token || !patient.notification_enabled) continue

    const prefs = (patient.med_time_notif_prefs ?? {}) as Record<string, boolean>
    const soundPrefs = (patient.med_time_sound_prefs ?? {}) as Record<string, string | null>
    const lang = resolveLang((patient as any).language)
    const tz = (patient as any).timezone || 'Asia/Seoul'
    // 슬롯별 알림음·방식(신규 단일 진실). 없으면 legacy soundPrefs 폴백.
    const slotAlarms = await getDoseSlotAlarms(patientId)

    for (const target of targets) {
      if (isMuted(prefs, target)) continue
      if (await hasTakenMed(patientId, target, tz)) continue

      const { channelId: soundChannel, alarmMode } = remindChannelAndMode(target, slotAlarms, soundPrefs)
      // ⚠️ 아키텍처(오너 확정 2026-07-20): 안드로이드의 '알람처럼'·'30초 동안'은 로컬 알람이 정각에
      //   울린다. 서버는 이 경우 **아예 발송하지 않는다**(중복 알림 방지 — 무음 백업도 안 보냄).
      //   iOS 는 로컬 알람이 없으므로 모든 방식을 서버가 소리로 보낸다. 안드 basic 도 서버가 소리.
      const platform = (patient as any).push_platform ?? null
      // 안드 '알람처럼'만 로컬 알람이 담당 → 서버 미발송(중복 방지). basic·(옛)sound30·iOS 는 서버가 소리.
      if (alarmMode === 'alarm' && platform === 'android') continue
      const channelId = soundChannel
      const data = { type: 'medication_reminder', mealTime: target.mealTime, doseSlotId: target.doseSlotId, alarmMode }
      const title = t(lang, 'med.time.title')
      const body = bodyFor(lang, 'reminder',
        periodLabelLoc(lang, target),
        formatClockTime(target.time))

      await sendPush(
        patient.push_token,
        title,
        body,
        data,
        channelId,
        platform,
      )
      await logNotification(patientId, 'medication_reminder', title, body, data)
      sent++
    }
  }

  // ── 2. 1차 미복용 알림 (+10분) — 환자에게만 ───────────────────────
  const { data: meds10 } = await supabase.rpc('get_meds_due', { offset_minutes: 10 })

  const first = groupTargets(meds10 as MedRow[] | null)
  for (const [patientId, targets] of first.entries()) {
    const { data: patient } = await supabase
      .from('users')
      .select('push_token, push_platform, notification_enabled, med_time_notif_prefs, med_time_sound_prefs, patient_group_id, language, timezone')
      .eq('id', patientId)
      .single()

    if (!patient?.push_token || !patient.notification_enabled) continue

    const prefs = (patient.med_time_notif_prefs ?? {}) as Record<string, boolean>
    const soundPrefs = (patient.med_time_sound_prefs ?? {}) as Record<string, string | null>
    const lang = resolveLang((patient as any).language)
    const tz = (patient as any).timezone || 'Asia/Seoul'
    // 환자가 1차 미복용 알림을 끈 경우 발송 안 함
    if (prefs.missed_first === false) continue
    // 미복용 1차 전용 알림음 (없으면 med_time_sound_prefs로 fallback)
    const missedSounds = await getMissedSoundPrefs(patientId)

    for (const target of targets) {
      if (isMuted(prefs, target)) continue
      if (await hasTakenMed(patientId, target, tz)) continue

      const channelId = missedChannelFor(missedSounds.first, soundPrefs, target)
      const data = { type: 'missed_medication_first', mealTime: target.mealTime, doseSlotId: target.doseSlotId }
      const title = t(lang, 'med.missed.title')
      const body = bodyFor(lang, 'missed',
        periodLabelLoc(lang, target),
        formatClockTime(target.time))

      await sendPush(
        patient.push_token,
        title,
        body,
        data,
        channelId,
        (patient as any).push_platform ?? null,
      )
      await logNotification(patientId, 'missed_medication', title, body, data)
      sent++
    }
  }

  // ── 3. 2차 미복용 알림 (+20분) — 환자 + 보호자 ───────────────────
  const { data: meds20 } = await supabase.rpc('get_meds_due', { offset_minutes: 20 })

  const second = groupTargets(meds20 as MedRow[] | null)
  for (const [patientId, targets] of second.entries()) {
    const { data: patient } = await supabase
      .from('users')
      .select('push_token, push_platform, notification_enabled, med_time_notif_prefs, med_time_sound_prefs, patient_group_id, language, timezone')
      .eq('id', patientId)
      .single()

    if (!patient?.notification_enabled) continue

    const prefs = (patient.med_time_notif_prefs ?? {}) as Record<string, boolean>
    const soundPrefs = (patient.med_time_sound_prefs ?? {}) as Record<string, string | null>
    const lang = resolveLang((patient as any).language)
    const tz = (patient as any).timezone || 'Asia/Seoul'
    // 미복용 2차 전용 알림음 (없으면 med_time_sound_prefs로 fallback) — 환자 본인만 적용
    const missedSounds = await getMissedSoundPrefs(patientId)

    for (const target of targets) {
      if (isMuted(prefs, target)) continue
      if (await hasTakenMed(patientId, target, tz)) continue

      const channelId = missedChannelFor(missedSounds.second, soundPrefs, target)

      // 환자에게 2차 알림 (환자가 2차 미복용 알림을 끈 경우 보내지 않음 — 보호자 알림은 아래에서 독립 처리)
      if (patient.push_token && prefs.missed_second !== false) {
        const data = { type: 'missed_medication_second', mealTime: target.mealTime, doseSlotId: target.doseSlotId }
        const title = t(lang, 'med.missed.title')
        const body = bodyFor(lang, 'missed',
          periodLabelLoc(lang, target),
          formatClockTime(target.time))
        await sendPush(
          patient.push_token,
          title,
          body,
          data,
          channelId,
          (patient as any).push_platform ?? null,
        )
        await logNotification(patientId, 'missed_medication', title, body, data)
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
    .select('id, push_token, push_platform, notification_enabled, exercise_notif_prefs, language, timezone')
    .eq('role', 'patient')
    .eq('notification_enabled', true)
    .not('push_token', 'is', null)

  for (const patient of allPatients ?? []) {
    if (!patient.push_token) continue
    const lang = resolveLang((patient as any).language)
    // 이 환자 tz 기준 현재 현지 HH:MM(Phase1-S3, 전역 KST currentTime 대체).
    // tz='Asia/Seoul'이면 기존 currentTime과 매분 동일 문자열(회귀 0).
    const patientCurrentTime = nowHHMMInTz((patient as any).timezone || 'Asia/Seoul')
    const prefs = (patient.exercise_notif_prefs ?? []) as Array<{
      id: string; ampm: string; hour: number; minute: number; enabled: boolean; soundId?: string | null
    }>
    for (const pref of prefs) {
      if (!pref.enabled) continue
      // ampm + hour → 24시간 현지 HH:MM 변환.
      // ampm 은 표시 문자열이 아니라 식별자다 — 'am'/'pm' 으로 저장한다.
      // 옛 행에는 '오전'/'오후' 가 남아 있을 수 있어 둘 다 받아준다.
      const LEGACY_PM = '\uC624\uD6C4' // 옛 저장값 '오후' — 미업데이트 앱이 다시 쓸 수 있어 받아준다
      const isPm = pref.ampm === 'pm' || pref.ampm === LEGACY_PM
      let h = pref.hour
      if (isPm && h !== 12) h += 12
      if (!isPm && h === 12) h = 0
      const target = `${String(h).padStart(2, '0')}:${String(pref.minute).padStart(2, '0')}`
      if (target !== patientCurrentTime) continue
      // 이 운동 알림 항목에 지정된 소리(soundId: 'preset:<id>' 프리셋 또는 녹음 uuid). 없으면 기본음.
      const exerciseChannelId = channelForStoredSound(pref.soundId)
      const title = t(lang, 'exercise.title')
      const body = t(lang, 'exercise.body')
      await sendPush(
        patient.push_token,
        title,
        body,
        { type: 'exercise_reminder' },
        exerciseChannelId,
        (patient as any).push_platform ?? null,
      )
      await logNotification(patient.id, 'exercise_reminder', title, body, { type: 'exercise_reminder' })
      sent++
    }
  }

  return new Response(JSON.stringify({ sent, time: currentTime, time10, time20 }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

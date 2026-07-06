/**
 * useMedication.ts
 * 약 복용 관련 훅
 *
 * - medications 목록 조회 (환자별 등록된 약)
 * - med_logs 오늘 복용 현황 (시간대별)
 * - takeMedication(mealTime) - 복용 기록 저장
 * - getMedLogs(date) - 날짜별 복용 내역 조회
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { sendCaregiverPush, scheduleEffectTrackingNotifications } from '../utils/notifications';
import { getLocalToday, getLocalDayRange } from '../utils/medUtils';
import i18n from '../i18n';
import { useSettings } from '../context/SettingsContext';
import {
  useDoseSlots,
  fetchPatientDoseSlots,
  invalidateDoseSlotsCache,
  type DoseSlot,
} from './useDoseSlots';
import { usePatientId } from './usePatientId';
import type { Database } from '../types/database';
import type { MealTime as MealTimeEnum } from '../types/database';

// 쓰기 경로(takeMedication)는 5단계 전환 전까지 legacy 4슬롯 enum 시그니처 보존.
type MealTime = MealTimeEnum;
type MedLogRow = Database['public']['Tables']['med_logs']['Row'];
type MedicationRow = Database['public']['Tables']['medications']['Row'];

export interface TodayMedStatus {
  morning: MedLogRow | null;
  lunch: MedLogRow | null;
  dinner: MedLogRow | null;
  bedtime: MedLogRow | null;
}

export interface UseMedicationReturn {
  medications: MedicationRow[];
  todayStatus: TodayMedStatus;
  /** 표시할 슬롯 리스트(dose_slots 있으면 그것, 없으면 legacy 가상 슬롯) */
  slots: DoseSlot[];
  /** 슬롯 단위 오늘 복용 현황. 키 = dose_slot id 또는 legacy meal_time */
  bySlotId: Record<string, MedLogRow | null>;
  /** dose_slots 기반 환자 여부(폴백 분기 단일 기준) */
  hasDoseSlots: boolean;
  /**
   * dose_slots 조회 진행 중 여부(useDoseSlots.loading 패스스루).
   * 콜드스타트에서 아직 슬롯이 도착하지 않은 동안 화면이 legacy 디폴트 시각을
   * 그리지 않고 스켈레톤을 보여주도록 하는 게이트. (med loading 과 별개)
   */
  slotsLoading: boolean;
  /** dose_slots 조회 실패 여부(=확정 0 아님). legacy 폴백 허용 판정에 사용. */
  slotsError: boolean;
  loading: boolean;
  error: string | null;
  /**
   * 복용 기록 저장(5단계 dual-write).
   * - mealTime: legacy 슬롯 키(있으면). 비표준 슬롯이면 null 가능.
   * - doseSlotId: dose_slots.id(이관 환자). 없으면 mealTime 으로 보충 시도.
   * med_logs.medication_id 는 항상 NULL(슬롯 단위 기록).
   *
   * 7단계: 반환값에 medLogId / doseSlotId 노출.
   * - 복용 직후 즉시 몸상태 팝업 경로가 on_off_logs.dose_slot_id / med_log_id 에 귀속하려면
   *   방금 기록한 복용의 식별자를 호출처가 알아야 함.
   * - success=false 면 medLogId / doseSlotId 는 null.
   */
  takeMedication: (args: { mealTime: MealTime | null; doseSlotId: string | null }) => Promise<{
    success: boolean;
    medLogId: string | null;
    doseSlotId: string | null;
    /**
     * 복용 직후 자동 몸상태 팝업 게이팅용.
     * effectiveNotifs 와 동일한 resolvedSlot(콜드스타트 시 fresh fetch) 기준으로 산출.
     * - dose_slot 환자: 그 슬롯의 track_enabled === true && trackIntervals.includes(0) 일 때만 true.
     *   (슬롯 못 찾음/추적 OFF/0 없음 → false. 전역 폴백·0 가정 금지.)
     * - legacy 환자(doseSlotId 없음): null → 호출처가 기존 동작(전역 medNotifs) 유지.
     */
    immediateTrack: boolean | null;
    /**
     * 방금 기록한 슬롯의 약효추적 설정(immediateTrack 과 동일한 resolvedSlot=fresh fetch 기준).
     * 호출처(다음알림 예고)가 큐 적재 race 와 무관하게 "복용 N분 후 약효추적" 후보를 결정적으로
     * 만들기 위해 사용한다. 화면 in-memory 의 stale/legacy displaySlots 에 의존하지 않도록 여기서 노출.
     * - dose_slot 환자: 슬롯의 track_enabled / track_intervals.
     * - legacy 환자(doseSlotId 없음) 또는 슬롯 못 찾음: null.
     */
    trackEnabled: boolean | null;
    trackIntervals: number[] | null;
  }>;
  cancelMedication: (medLogId: string) => Promise<boolean>;
  getMedLogs: (date: string) => Promise<MedLogRow[]>;
  refresh: () => Promise<void>;
}

const MEAL_TIME_LABELS: Record<string, string> = {
  morning: '아침',
  lunch: '점심',
  dinner: '저녁',
  bedtime: '취침',
};

export function useMedication(): UseMedicationReturn {
  const { user } = useAuth();
  const { medNotifs } = useSettings();
  const {
    slots,
    hasDoseSlots,
    getSlotByLegacyKey,
    getSlotById,
    loading: slotsLoading,
    slotsError,
  } = useDoseSlots();
  // ⚠️ realtime 즉시 반영 핵심: dose_slots realtime 이 즉시 동작하는 이유는
  //    usePatientId() 가 마운트 직후 useEffect 로 patientId 를 resolve 해서
  //    구독 useEffect 가 patientId 가 채워지자마자 곧바로 활성화되기 때문이다.
  //    medications realtime 도 동일하게 usePatientId() 의 patientId 로 구독해
  //    "fetchMedications 실행을 기다려야 patient_id 가 채워지던" 지연을 제거한다.
  const { patientId: rtPatientId } = usePatientId();
  const [medications, setMedications] = useState<MedicationRow[]>([]);
  const [todayStatus, setTodayStatus] = useState<TodayMedStatus>({
    morning: null,
    lunch: null,
    dinner: null,
    bedtime: null,
  });
  const [bySlotId, setBySlotId] = useState<Record<string, MedLogRow | null>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // realtime 채널 이름은 훅 인스턴스마다 고유해야 한다(여러 화면이 같은 환자의 useMedication 을
  // 동시에 쓰면 같은 채널 재사용 → subscribe 후 .on() 추가 시도 크래시). 인스턴스별 suffix 로 충돌 방지.
  const rtChannelId = useRef(Math.random().toString(36).slice(2, 10));
  // realtime 콜백 stale 클로저 방지: 콜백은 항상 최신 fetchMedications 를 ref 로 호출한다.
  // (콜백을 deps 에 넣어 채널을 재생성하면 일시적으로 구독이 끊겨 이벤트를 놓칠 수 있다.)
  const fetchMedicationsRef = useRef<() => void>(() => {});
  // ⚠️ 더블탭 방어(in-flight 락): 약 복용 저장 버튼을 빠르게 두 번 누르면 takeMedication 이
  //    동시 2회 실행돼 med_logs 가 갈라지고(upsert RPC 가 둘 다 "기존없음"으로 읽어 각각 insert),
  //    약효추적 큐도 N세트로 늘어 같은 복용에 알림이 2~3번 발송됐다(라이브 확정).
  //    디바운스가 아니라 "완료까지 차단"하는 락이어야 함 — 저장이 끝나기(성공/실패) 전의
  //    두 번째 호출은 즉시 무시한다. finally 에서 해제.
  const savingRef = useRef(false);

  // 환자 ID 결정: 환자이면 본인, 보호자이면 연동된 환자 ID
  const getPatientId = useCallback(async (): Promise<string | null> => {
    if (!user) return null;
    if (user.role === 'patient') return user.id;

    // 보호자인 경우 그룹에서 환자 ID 조회
    if (!user.patient_group_id) {
      console.warn('[useMedication] 보호자 patient_group_id=null → 환자 미연동');
      return null;
    }

    const { data, error } = await supabase
      .from('patient_group_members')
      .select('user_id, role')
      .eq('group_id', user.patient_group_id)
      .eq('role', 'patient')
      .single();

    if (error) {
      console.error('[useMedication] getPatientId 그룹 조회 오류:', error);
    }

    return data?.user_id ?? null;
  }, [user]);

  // 오늘 복용 현황 조회
  const fetchTodayStatus = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      const patientId = await getPatientId();
      if (!patientId) {
        setLoading(false);
        return;
      }

      const tz = user?.timezone || 'Asia/Seoul';
      const today = getLocalToday(tz);
      const { start, end } = getLocalDayRange(today, tz);

      const { data, error: queryError } = await supabase
        .from('med_logs')
        .select('*')
        .eq('patient_id', patientId)
        .gte('taken_at', start)
        .lte('taken_at', end)
        .order('taken_at', { ascending: false });

      if (queryError) throw queryError;

      const status: TodayMedStatus = {
        morning: null,
        lunch: null,
        dinner: null,
        bedtime: null,
      };

      // 슬롯 단위 현황(additive). 키 = 정규 슬롯 키.
      // ⚠️ 회귀 수정: 이관 환자(dose_slots 보유)는 과거 back-fill 로그=dose_slot_id(UUID),
      // 오늘 새 로그=meal_time(쓰기 5단계 전이라 dose_slot_id NULL)로 키가 갈렸음.
      // → log.meal_time 을 같은 슬롯의 정규 UUID 로 매핑해 키를 통일한다.
      //   우선순위: log.dose_slot_id ?? getSlotByLegacyKey(log.meal_time)?.id ?? log.meal_time
      // 미이관 환자는 slots 가 비어 매핑 실패 → meal_time 키 유지(legacy 매칭 정상).
      // ⚠️ med_logs.medication_id 는 전부 NULL(슬롯 단위 기록) → 약 단위 그룹핑 금지.
      const slotMap: Record<string, MedLogRow | null> = {};

      // legacyKey(meal_time) → 정규 dose_slot id 매핑 (이관 환자 키 통일용).
      const legacyKeyToSlotId = new Map<string, string>();
      slots.forEach((s) => {
        if (s.legacyKey && s.id) legacyKeyToSlotId.set(s.legacyKey, s.id);
      });

      // taken_at desc 정렬이므로 같은 키 첫 행 = 최근 기록
      data?.forEach((log) => {
        // legacy 4슬롯 객체(기존 호출처 보존)
        if (log.meal_time) {
          const slot = log.meal_time as keyof TodayMedStatus;
          if (slot in status && !status[slot]) {
            status[slot] = log;
          }
        }

        // 슬롯 단위 컬렉션 — 정규 키로 통일
        const key =
          log.dose_slot_id ??
          (log.meal_time ? legacyKeyToSlotId.get(log.meal_time) : undefined) ??
          log.meal_time;
        if (key && !slotMap[key]) {
          slotMap[key] = log;
        }
      });

      setTodayStatus(status);
      setBySlotId(slotMap);
    } catch (err: any) {
      console.error('[useMedication] fetchTodayStatus 오류:', err);
      setError(err.message ?? '복용 현황을 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, [user, getPatientId, slots]);

  // 활성 약 목록 조회
  const fetchMedications = useCallback(async () => {
    if (!user) return;

    try {
      const patientId = await getPatientId();
      if (!patientId) return;

      const { data, error: queryError } = await supabase
        .from('medications')
        .select('*')
        .eq('patient_id', patientId)
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      if (queryError) throw queryError;
      setMedications(data ?? []);
    } catch (err: any) {
      console.error('[useMedication] fetchMedications 오류:', err);
    }
  }, [user, getPatientId]);

  // 콜백 ref 를 항상 최신 fetchMedications 로 유지(stale 클로저 방지).
  useEffect(() => {
    fetchMedicationsRef.current = fetchMedications;
  }, [fetchMedications]);

  // 복용약 realtime — 환자/보호자 한쪽이 약을 추가·수정·삭제(중단)하면 다른쪽 약복용 탭도
  // 새로고침 없이 즉시 반영. dose_slots realtime(useDoseSlots) 과 동일 패턴.
  //  - 구독 트리거: usePatientId() 가 resolve 한 rtPatientId (마운트 직후 채워짐).
  //    → fetchMedications 가 먼저 돌기를 기다리던 지연을 제거(즉시 구독).
  //  - 콜백: fetchMedicationsRef 로 최신 fetch 호출(채널 재생성 없이 deps 안정).
  useEffect(() => {
    if (!rtPatientId) return;
    const channel = supabase
      .channel(`medications-rt-${rtPatientId}-${rtChannelId.current}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'medications', filter: `patient_id=eq.${rtPatientId}` },
        () => { fetchMedicationsRef.current(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [rtPatientId]);

  // 초기 로드 — 서로 독립이라 순차 await 대신 병렬로(로딩 워터폴 제거)
  useEffect(() => {
    if (user) {
      void Promise.all([fetchMedications(), fetchTodayStatus()]);
    }
  }, [user, fetchMedications, fetchTodayStatus]);

  // 복용 기록 저장 (5단계 dual-write)
  const takeMedication = useCallback(async (
    args: { mealTime: MealTime | null; doseSlotId: string | null }
  ): Promise<{ success: boolean; medLogId: string | null; doseSlotId: string | null; immediateTrack: boolean | null; trackEnabled: boolean | null; trackIntervals: number[] | null }> => {
    const mealTime = args.mealTime;
    // doseSlotId 보충: doseSlotId 없고 mealTime 만 오면(미이관 가능) legacyKey→slot.id 시도.
    // 매핑 실패(미이관 환자)면 null → 순수 legacy 경로.
    const doseSlotId =
      args.doseSlotId ?? (mealTime ? getSlotByLegacyKey(mealTime)?.id ?? null : null);

    if (!user) return { success: false, medLogId: null, doseSlotId: null, immediateTrack: null, trackEnabled: null, trackIntervals: null };

    // 따로 거주하는 보호자는 약 복용 기록 불가 (UI 우회 방어)
    if (user.role === 'caregiver' && user.residence_type === 'separate') {
      setError(i18n.t('medicationHook.separateResidenceError'));
      return { success: false, medLogId: null, doseSlotId: null, immediateTrack: null, trackEnabled: null, trackIntervals: null };
    }

    // ⚠️ 더블탭 방어(in-flight 락): 이전 저장이 끝나기 전 두 번째 호출은 즉시 무시한다.
    //    (위 검증성 early-return 들은 저장을 시작하지 않으므로 락 밖에 둔다.)
    //    같은 복용에 med_logs 분기 + 약효추적 알림 2~3번 발송을 클라 단에서 1차 차단.
    if (savingRef.current) {
      console.warn('[useMedication] takeMedication 재진입 차단(저장 진행 중) — 더블탭 무시');
      return { success: false, medLogId: null, doseSlotId: null, immediateTrack: null, trackEnabled: null, trackIntervals: null };
    }
    savingRef.current = true;

    setLoading(true);
    setError(null);

    try {
      const patientId = await getPatientId();
      if (!patientId) {
        const msg = i18n.t('medicationHook.noPatientError');
        console.error('[useMedication] takeMedication: patientId null → insert 중단');
        setError(msg);
        return { success: false, medLogId: null, doseSlotId: null, immediateTrack: null, trackEnabled: null, trackIntervals: null };
      }

      // dual-write 보조: doseSlot 이 표준 라벨이면 legacyKey 를 meal_time 에 함께 기록.
      // (mealTime 이 명시되면 그대로, 아니면 슬롯의 legacyKey, 둘 다 없으면 null=비표준 슬롯)
      // 슬롯 해결: in-memory 캐시 우선, 콜드스타트로 캐시가 비어 못 찾으면
      // 그 자리에서 최신 슬롯을 직접 조회(fresh fetch)해 확실히 해결한다.
      // ⚠️ dose_slot 환자가 슬롯을 못 찾으면 전역 medNotifs 로 폴백 → 잘못된 알림 큐잉
      //    버그가 났었음. fresh fetch 로 콜드스타트에서도 슬롯을 반드시 찾도록 보강.
      let resolvedSlot = doseSlotId ? getSlotById(doseSlotId) : undefined;
      if (doseSlotId && !resolvedSlot && patientId) {
        try {
          // 캐시가 비어있을 수도/stale 일 수도 있으므로 무효화 후 최신 조회.
          invalidateDoseSlotsCache(patientId);
          const fresh = await fetchPatientDoseSlots(patientId);
          resolvedSlot = fresh.find((s) => s.id === doseSlotId);
        } catch {
          // 조회 실패해도 throw 금지 — 아래 effectiveNotifs 가 빈 배열로 안전 처리.
        }
      }
      const effectiveMealTime: MealTime | null =
        mealTime ?? (resolvedSlot?.legacyKey ?? null);

      // 유효 약효추적 알림설정(단일 소스). 만료시각/큐잉/로컬폴백이 모두 이걸 씀.
      // dose_slot 경로: 슬롯의 track_intervals(track_enabled 게이트)를 사용.
      //  - trackEnabled=false → 빈 배열(약효추적 알림 없음)
      //  - trackEnabled=true  → trackIntervals 각 분(minutes)을 enabled:true 로
      // legacy 경로(미이관, doseSlotId 없음): 기존대로 전역 medNotifs.
      // ⚠️ 버그수정: 이전엔 dose_slot 환자도 전역 medNotifs(예 30·120)를 큐잉해
      //    슬롯별 [0](복용즉시만) 설정이 무시됐음.
      // ⚠️ 핵심 버그수정: dose_slot 환자(doseSlotId 존재)는 절대 전역 medNotifs 로
      //    폴백하지 않는다. 슬롯 기준만 사용:
      //    - trackEnabled=true  → trackIntervals 각 분(minutes)을 enabled:true 로
      //    - trackEnabled=false 또는 (fresh fetch 후에도) 슬롯 못 찾음 → 빈 배열([])
      //      (전역 medNotifs 폴백 금지 — 잘못된 알림보다 누락이 안전)
      //    legacy 경로(doseSlotId 없음, 미이관 환자)만 기존대로 전역 medNotifs.
      const effectiveNotifs: { id: string; minutes: number; enabled: boolean; soundId: string | null }[] =
        doseSlotId
          ? (resolvedSlot && resolvedSlot.trackEnabled
              ? (resolvedSlot.trackIntervals ?? []).map((m) => ({
                  id: `slot-${m}`,
                  minutes: m,
                  enabled: true,
                  soundId: null,
                }))
              : []) // dose_slot 인데 비활성이거나 못 찾음 → 빈 배열(전역 폴백 금지)
          : medNotifs.map((n) => ({
              id: n.id,
              minutes: n.minutes,
              enabled: n.enabled,
              soundId: n.soundId ?? null,
            }));

      // ⚠️ medication_id 는 항상 NULL(슬롯 단위 기록).
      // measurements.med_intake_id→med_logs(id) FK 결합 주의: insert 는 1회만, 재생성 금지.
      const nowIso = new Date().toISOString();
      const insertData: any = {
        patient_id: patientId,
        logged_by: user.id,
        medication_id: null,
        taken_at: nowIso,
        meal_time: effectiveMealTime,
        dose_slot_id: doseSlotId,
      };

      // 덮어쓰기(마지막 것만): 같은 슬롯·같은 날 기존 복용기록이 있으면 새 행을 만들지 않고
      // 그 행의 시각만 갱신(RPC, SECURITY DEFINER). id 유지 → 약효추적/측정 FK 참조 보존 +
      // effect_tracking_queue 가 med_log_id 기준 dedup 이라 약효추적 알림 중복도 자동 방지.
      // RPC 가 NULL(기존 없음)이거나 실패하면 기존대로 새로 insert.
      let medLogId: string | undefined;
      const { data: overwrittenId, error: rpcError } = await (supabase.rpc as any)('upsert_med_log_time', {
        p_patient_id: patientId,
        p_dose_slot_id: doseSlotId,
        p_meal_time: effectiveMealTime,
        p_taken_at: nowIso,
        p_logged_by: user.id,
      });
      if (!rpcError && overwrittenId) {
        medLogId = overwrittenId as string;
      } else {
        const { data: insertedLog, error: insertError } = await supabase
          .from('med_logs')
          .insert(insertData)
          .select('id')
          .single();
        if (insertError) throw insertError;
        medLogId = insertedLog?.id;
      }

      // 복용 시각 AsyncStorage 저장 (약효 추적 trigger_time_label 추론용)
      // expires_at 추가: 마지막 약효추적 인터벌 + 30분 후 만료
      // → 이전 복용 데이터가 stale 상태로 살아남아 잘못된 자동 추정 트리거 방지
      const enabledIntervals = effectiveNotifs
        .filter((n) => n.enabled && n.minutes > 0)
        .map((n) => n.minutes);
      const lastIntervalMin =
        enabledIntervals.length > 0 ? Math.max(...enabledIntervals) : 0;
      const expiresAtMs = Date.now() + (lastIntervalMin + 30) * 60 * 1000;
      await AsyncStorage.setItem(
        'parkinon_last_medication',
        JSON.stringify({
          taken_at: new Date().toISOString(),
          meal_time: effectiveMealTime,
          dose_slot_id: doseSlotId,
          expires_at: new Date(expiresAtMs).toISOString(),
        })
      ).catch(() => {});

      // DB INSERT 성공 후 알림/큐/뱃지 처리 — 복용 직후 팝업을 즉시 띄우기 위해
      // 느린 엣지함수 invoke 들을 await 하지 않고 백그라운드로 보낸다(복용 기록은 이미 저장됨).
      void (async () => {
      try {
        // 약효 추적 알림 큐잉.
        //  - 신규 분기(doseSlotId 존재): 서버가 dose_slot.track_enabled 로 게이트.
        //    → 취침 하드제외를 클라가 하지 않고 항상 호출(서버에 큐 정합 위임).
        //  - 구 분기(doseSlotId 없음, 미이관 환자): 기존 meal_time 경로 그대로(bedtime 스킵 보존).
        const notifSettings = effectiveNotifs.map((n) => ({
          minutes: n.minutes,
          enabled: n.enabled,
          soundId: n.soundId,
        }));

        if (user?.push_token) {
          if (doseSlotId) {
            // ⚠️ 신규 payload 는 dose_slot_id + med_log_id 가 반드시 쌍이어야 한다.
            //    medLogId 가 undefined 면 서버가 400(med_log_id required) → 절대 보내지 않음.
            //    (이 경우 큐잉 누락만 발생, 복용 기록 자체는 이미 저장됨.)
            if (medLogId) {
              await supabase.functions.invoke('queue-effect-tracking', {
                body: {
                  patient_id: patientId,
                  push_token: user.push_token,
                  dose_slot_id: doseSlotId,
                  med_log_id: medLogId,
                  notif_settings: notifSettings,
                  meal_time: effectiveMealTime ?? null, // 호환용(서버가 표시/legacy 보관)
                },
              });
            } else {
              console.warn('[useMedication] medLogId 없음 → 신규 약효추적 큐잉 생략(서버 400 방지)');
            }
          } else {
            // 미이관(legacy) 경로 — 취침약은 서버가 스킵하므로 그대로 호출.
            await supabase.functions.invoke('queue-effect-tracking', {
              body: {
                patient_id: patientId,
                push_token: user.push_token,
                meal_time: mealTime,
                notif_settings: notifSettings,
              },
            });
          }
        } else {
          // push_token 없을 때 로컬 폴백 — 양쪽 경로 공통 유지.
          // ⚠️ 누수 수정: 비-푸시 환경엔 서버 게이트(track_enabled)가 없으므로
          //    로컬 폴백이 직접 슬롯의 trackEnabled 를 반영해야 한다.
          //    - doseSlotId 경로(이관 환자): resolvedSlot.trackEnabled === true 일 때만 로컬 약효알림.
          //      (이관 환자 취침 슬롯은 track_enabled=false → 로컬 알림 누수 차단, 구 동작과 일치.)
          //    - legacy 경로(미이관): 기존 `mealTime !== 'bedtime'` 보존(취침 하드제외).
          const localTrackAllowed = doseSlotId
            ? resolvedSlot?.trackEnabled === true
            : mealTime !== 'bedtime';
          if (localTrackAllowed) {
            await scheduleEffectTrackingNotifications(effectiveNotifs);
          }
        }

        // 보호자에게 푸시 알림 (같은 그룹의 보호자 push_token 조회 후 전송)
        if (user.patient_group_id) {
          const { data: caregivers } = await supabase
            .from('patient_group_members')
            .select('user_id')
            .eq('group_id', user.patient_group_id)
            .eq('role', 'caregiver');

          if (caregivers && caregivers.length > 0) {
            const caregiverIds = caregivers.map((c: any) => c.user_id);
            const { data: caregiverUsers } = await supabase
              .from('users')
              .select('push_token, caregiver_notif_prefs')
              .in('id', caregiverIds)
              .not('push_token', 'is', null);

            // 환자 이름 조회
            let patientName = i18n.t('medicationHook.defaultPatientName');
            if (user.role === 'patient') {
              patientName = user.name || i18n.t('medicationHook.defaultPatientName');
            } else {
              // 보호자인 경우 연동된 환자 이름 조회
              const { data: patientRow } = await supabase
                .from('users')
                .select('name')
                .eq('id', patientId)
                .single();
              if (patientRow?.name) patientName = patientRow.name;
            }

            for (const cu of caregiverUsers ?? []) {
              if (!cu.push_token) continue;
              const prefs = (cu.caregiver_notif_prefs ?? {}) as Record<string, boolean>;
              if (prefs.med_taken === false) continue;
              await sendCaregiverPush(
                cu.push_token,
                i18n.t('medicationHook.pushTitle'),
                i18n.t('medicationHook.pushBody', { name: patientName }),
                { type: 'caregiver_medication' },
              );
            }
          }
        }
      } catch (notifErr) {
        console.error('[useMedication] 알림 처리 실패 (복용 기록은 저장됨):', notifErr);
      }
      })();

      // 약 복용 시점에 "방금 기록한 그 슬롯/그날"의 미읽음 약 알림만 읽음 처리.
      //  - 대상 type: medication_reminder, missed_medication(1·2차 모두 DB엔 missed_medication)
      //  - 범위: 오늘(KST) created_at 내 + 미읽음
      //  - 슬롯 매칭: 알림 data 의 doseSlotId(우선) / mealTime 으로 좁힌다.
      //    (다른 슬롯·다른 날·다른 타입 알림은 절대 건드리지 않음)
      //  - RLS: notification_logs 는 본인(auth.uid()=user_id) update 허용 → 직접 update 가능.
      //    환자 본인이 기록하면 user.id=patient. 보호자 대신 기록 시엔 보호자 종 배지엔
      //    약 알림이 없고, 환자 알림은 RLS상 보호자가 못 건드림(의도된 동작).
      //  배지(종) 즉시 갱신은 호출처(MedicationScreen)가 takeMedication 성공 후
      //  refreshBadge() 를 호출해 처리한다. 여기선 update 를 await 해 read_at 반영을 보장.
      try {
        const nowIso = new Date().toISOString();
        const tz = user?.timezone || 'Asia/Seoul';
        const today = getLocalToday(tz);
        const { start: dayStart, end: dayEnd } = getLocalDayRange(today, tz);
        let q = supabase
          .from('notification_logs')
          .update({ read_at: nowIso })
          .eq('user_id', user.id)
          .in('type', ['medication_reminder', 'missed_medication'])
          .is('read_at', null)
          .gte('created_at', dayStart)
          .lte('created_at', dayEnd);
        // 슬롯 식별이 가능하면 그 슬롯으로 좁힌다(과도한 일괄 읽음 방지).
        if (doseSlotId) {
          q = q.eq('data->>doseSlotId', doseSlotId);
        } else if (effectiveMealTime) {
          q = q.eq('data->>mealTime', effectiveMealTime);
        }
        await q;
      } catch (markReadErr) {
        // 약 기록 자체는 이미 성공이므로 silent
        console.error('[useMedication] 알림 읽음 처리 실패 (복용 기록은 저장됨):', markReadErr);
      }

      // 오늘 현황 갱신 (카드 반영) — (성능) await 하지 않고 백그라운드 재조회로 돌린다.
      //   호출처(MedicationScreen.proceedSave)가 직후 몸상태 팝업으로 진행하는 걸 막지 않도록.
      //   반환값(medLogId/doseSlotId/immediateTrack)은 이 재조회 결과에 의존하지 않으므로 안전.
      //   카드 반영이 약간 늦어도 재조회가 곧 갱신한다.
      void fetchTodayStatus();
      // 7단계: 방금 기록한 복용의 식별자 반환(즉시 몸상태 팝업 경로의 슬롯 귀속용).
      //   doseSlotId 는 보충 후 effective 값, medLogId 는 insert 의 .select('id') 결과.
      // 복용 직후 팝업 게이팅: effectiveNotifs 와 동일한 resolvedSlot 기준으로 산출.
      //   - dose_slot 환자: trackEnabled && trackIntervals 에 0 포함일 때만 true.
      //     (슬롯 못 찾음/추적 OFF/0 없음 → false. 0 가정·전역 폴백 금지.)
      //   - legacy 환자(doseSlotId 없음): null → 호출처가 기존 동작 유지.
      const immediateTrack: boolean | null = doseSlotId
        ? (resolvedSlot?.trackEnabled === true && (resolvedSlot.trackIntervals ?? []).includes(0))
        : null;
      // 약효추적 후보를 호출처에서 결정적으로 만들 수 있도록 resolvedSlot(fresh) 설정도 같이 반환.
      const trackEnabled: boolean | null = doseSlotId ? (resolvedSlot?.trackEnabled ?? null) : null;
      const trackIntervals: number[] | null = doseSlotId ? (resolvedSlot?.trackIntervals ?? null) : null;
      return { success: true, medLogId: medLogId ?? null, doseSlotId: doseSlotId ?? null, immediateTrack, trackEnabled, trackIntervals };
    } catch (err: any) {
      console.error('[useMedication] takeMedication 오류:', err);
      setError(err.message ?? i18n.t('medicationHook.saveError'));
      return { success: false, medLogId: null, doseSlotId: null, immediateTrack: null, trackEnabled: null, trackIntervals: null };
    } finally {
      setLoading(false);
      // in-flight 락 해제(성공/실패 무관). 백그라운드 알림/큐잉(void async)은 DB insert 후
      // 이미 시작됐으므로 락은 동기 본문(insert·반환값 산출) 종료 시점에 풀어도 안전하다.
      savingRef.current = false;
    }
  }, [user, getPatientId, fetchTodayStatus, medNotifs, getSlotByLegacyKey, getSlotById]);

  // 복용 기록 취소(삭제)
  // RLS는 logged_by=본인만 삭제 허용 → 보호자가 환자 기록을 못 지움.
  // RPC(cancel_patient_record)로 권한 자체검증 + RLS 우회하여 삭제.
  const cancelMedication = useCallback(async (medLogId: string): Promise<boolean> => {
    if (!user) return false;
    setError(null);

    try {
      // ⚠️ 약효추적 큐 정리는 클라이언트에서 하지 않는다.
      //    - effect_tracking_queue 에는 DELETE RLS 정책이 없어 클라 delete 는 0행(무효).
      //    - 현재 쓰기 경로는 legacy(meal_time) 라 큐의 med_log_id 가 NULL → med_log_id 매칭도 0행.
      //    → 큐 정리는 cancel_patient_record RPC(SECURITY DEFINER) 내부에서
      //      med_log 삭제 '이전에' 처리한다. (migration 20260609000000)
      //      신규 dose_slot 경로(med_log_id 1:1) + legacy(meal_time+taken_at) 모두 커버.
      const { error: rpcError } = await supabase.rpc('cancel_patient_record', {
        p_table: 'med_logs',
        p_record_id: medLogId,
      });

      if (rpcError) throw rpcError;

      // 오늘 현황 갱신
      await fetchTodayStatus();
      return true;
    } catch (err: any) {
      console.error('[useMedication] cancelMedication 오류:', err);
      setError(err.message ?? i18n.t('medicationHook.cancelError'));
      return false;
    }
  }, [user, fetchTodayStatus]);

  // 날짜별 복용 내역 조회
  const getMedLogs = useCallback(async (date: string): Promise<MedLogRow[]> => {
    if (!user) return [];

    try {
      const patientId = await getPatientId();
      if (!patientId) return [];

      const { start, end } = getLocalDayRange(date, user?.timezone || 'Asia/Seoul');
      const { data, error: queryError } = await supabase
        .from('med_logs')
        .select('*')
        .eq('patient_id', patientId)
        .gte('taken_at', start)
        .lte('taken_at', end)
        .order('taken_at', { ascending: true });

      if (queryError) throw queryError;
      return data ?? [];
    } catch (err: any) {
      console.error('[useMedication] getMedLogs 오류:', err);
      return [];
    }
  }, [user, getPatientId]);

  // 새로고침
  const refresh = useCallback(async () => {
    await Promise.all([fetchMedications(), fetchTodayStatus()]);
  }, [fetchMedications, fetchTodayStatus]);

  return {
    medications,
    todayStatus,
    slots,
    bySlotId,
    hasDoseSlots,
    slotsLoading,
    slotsError,
    loading,
    error,
    takeMedication,
    cancelMedication,
    getMedLogs,
    refresh,
  };
}

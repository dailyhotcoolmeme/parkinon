/**
 * useMedication.ts
 * 약 복용 관련 훅
 *
 * - medications 목록 조회 (환자별 등록된 약)
 * - med_logs 오늘 복용 현황 (시간대별)
 * - takeMedication(mealTime) - 복용 기록 저장
 * - getMedLogs(date) - 날짜별 복용 내역 조회
 */
import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { sendCaregiverPush, scheduleEffectTrackingNotifications } from '../utils/notifications';
import { getKSTToday, getKSTDayRange } from '../utils/medUtils';
import { useSettings } from '../context/SettingsContext';
import { useDoseSlots, type DoseSlot } from './useDoseSlots';
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
  const { slots, hasDoseSlots, getSlotByLegacyKey, getSlotById } = useDoseSlots();
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

      const today = getKSTToday();
      const { start, end } = getKSTDayRange(today);

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

  // 초기 로드
  useEffect(() => {
    if (user) {
      fetchMedications();
      fetchTodayStatus();
    }
  }, [user, fetchMedications, fetchTodayStatus]);

  // 복용 기록 저장 (5단계 dual-write)
  const takeMedication = useCallback(async (
    args: { mealTime: MealTime | null; doseSlotId: string | null }
  ): Promise<{ success: boolean; medLogId: string | null; doseSlotId: string | null }> => {
    const mealTime = args.mealTime;
    // doseSlotId 보충: doseSlotId 없고 mealTime 만 오면(미이관 가능) legacyKey→slot.id 시도.
    // 매핑 실패(미이관 환자)면 null → 순수 legacy 경로.
    const doseSlotId =
      args.doseSlotId ?? (mealTime ? getSlotByLegacyKey(mealTime)?.id ?? null : null);

    if (!user) return { success: false, medLogId: null, doseSlotId: null };

    // 따로 거주하는 보호자는 약 복용 기록 불가 (UI 우회 방어)
    if (user.role === 'caregiver' && user.residence_type === 'separate') {
      setError('따로 거주하는 보호자는 약 복용을 기록할 수 없어요.');
      return { success: false, medLogId: null, doseSlotId: null };
    }

    setLoading(true);
    setError(null);

    try {
      const patientId = await getPatientId();
      if (!patientId) {
        const msg = '복용 기록을 저장할 환자 정보를 찾을 수 없어요. 가족 연동 후 다시 시도해 주세요.';
        console.error('[useMedication] takeMedication: patientId null → insert 중단');
        setError(msg);
        return { success: false, medLogId: null, doseSlotId: null };
      }

      // dual-write 보조: doseSlot 이 표준 라벨이면 legacyKey 를 meal_time 에 함께 기록.
      // (mealTime 이 명시되면 그대로, 아니면 슬롯의 legacyKey, 둘 다 없으면 null=비표준 슬롯)
      const resolvedSlot = doseSlotId ? getSlotById(doseSlotId) : undefined;
      const effectiveMealTime: MealTime | null =
        mealTime ?? (resolvedSlot?.legacyKey ?? null);

      // ⚠️ medication_id 는 항상 NULL(슬롯 단위 기록).
      // measurements.med_intake_id→med_logs(id) FK 결합 주의: insert 는 1회만, 재생성 금지.
      const insertData: any = {
        patient_id: patientId,
        logged_by: user.id,
        medication_id: null,
        taken_at: new Date().toISOString(),
        meal_time: effectiveMealTime,
        dose_slot_id: doseSlotId,
      };

      const { data: insertedLog, error: insertError } = await supabase
        .from('med_logs')
        .insert(insertData)
        .select('id')
        .single();

      if (insertError) throw insertError;
      const medLogId: string | undefined = insertedLog?.id;

      // 복용 시각 AsyncStorage 저장 (약효 추적 trigger_time_label 추론용)
      // expires_at 추가: 마지막 약효추적 인터벌 + 30분 후 만료
      // → 이전 복용 데이터가 stale 상태로 살아남아 잘못된 자동 추정 트리거 방지
      const enabledIntervals = medNotifs
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
        const notifSettings = medNotifs.map((n) => ({
          minutes: n.minutes,
          enabled: n.enabled,
          soundId: n.soundId ?? null,
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
            await scheduleEffectTrackingNotifications(medNotifs);
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
            let patientName = '환자분';
            if (user.role === 'patient') {
              patientName = user.name || '환자분';
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
                '💊 약을 드셨어요',
                `${patientName}님이 약을 드셨어요.`,
                { type: 'caregiver_medication' },
              );
            }
          }
        }
      } catch (notifErr) {
        console.error('[useMedication] 알림 처리 실패 (복용 기록은 저장됨):', notifErr);
      }

      // 약 복용 시점에 같은 사용자의 미읽음 약 알림(medication_reminder/missed_medication)
      // 일괄 읽음 처리 → 종 아이콘 뱃지 즉시 감소
      // 다른 타입(약효추적/운동/몸상태)은 건드리지 않음
      try {
        const nowIso = new Date().toISOString();
        await supabase
          .from('notification_logs')
          .update({ read_at: nowIso })
          .eq('user_id', user.id)
          .in('type', ['medication_reminder', 'missed_medication'])
          .is('read_at', null);
      } catch (markReadErr) {
        // 약 기록 자체는 이미 성공이므로 silent
        console.error('[useMedication] 알림 읽음 처리 실패 (복용 기록은 저장됨):', markReadErr);
      }
      })();

      // 오늘 현황 갱신 (카드 반영 — 빠른 읽기라 유지)
      await fetchTodayStatus();
      // 7단계: 방금 기록한 복용의 식별자 반환(즉시 몸상태 팝업 경로의 슬롯 귀속용).
      //   doseSlotId 는 보충 후 effective 값, medLogId 는 insert 의 .select('id') 결과.
      return { success: true, medLogId: medLogId ?? null, doseSlotId: doseSlotId ?? null };
    } catch (err: any) {
      console.error('[useMedication] takeMedication 오류:', err);
      setError(err.message ?? '복용 기록 저장에 실패했어요.');
      return { success: false, medLogId: null, doseSlotId: null };
    } finally {
      setLoading(false);
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
      setError(err.message ?? '복용 기록을 취소하지 못했어요.');
      return false;
    }
  }, [user, fetchTodayStatus]);

  // 날짜별 복용 내역 조회
  const getMedLogs = useCallback(async (date: string): Promise<MedLogRow[]> => {
    if (!user) return [];

    try {
      const patientId = await getPatientId();
      if (!patientId) return [];

      const { start, end } = getKSTDayRange(date);
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
    loading,
    error,
    takeMedication,
    cancelMedication,
    getMedLogs,
    refresh,
  };
}

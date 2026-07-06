import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Share,
  LayoutAnimation,
  Platform,
  UIManager,
  Clipboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { isOverseasLocale } from '../../i18n/detectLocale';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { Colors } from '../../constants/colors';
import { BrandProgressOverlay } from '../../components/common/BrandProgressOverlay';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../context/DialogContext';
import { supabase } from '../../lib/supabase';
import { ensureGroupMember } from '../../utils/groupMembership';
import {
  ensurePatientDoseSlots,
  syncMedicationDoseSlots,
  invalidateDoseSlotsCache,
} from '../../hooks/useDoseSlots';
import type { LegacyMealKey } from '../../constants/doseSlots';

type Nav = StackNavigationProp<OnboardingStackParamList, 'FamilyInvite'>;

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// 초대 번호: 순수 숫자 6자리 (DB 저장·공유 텍스트는 공백 없이, 화면 표시만 3-3 그룹)
// brute-force 방어는 서버측 만료 강제 + 시도 제한으로 처리.
function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
}

// "123456" → "123 456" (표시 전용). 구버전 8자리 코드는 4-4 으로 폴백.
function formatInviteCode(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  return code;
}

export function FamilyInviteScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();
  // 해외 로케일: 노란 카카오 스타일 대신 중립 스타일(공유 텍스트/라벨은 로케일별 리소스).
  const overseas = isOverseasLocale();
  const { refreshUser, forceCompleteOnboarding } = useAuth();
  const dialog = useDialog();
  const [inviteCode, setInviteCode] = useState('');
  const [userName, setUserName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [inviteExpanded, setInviteExpanded] = useState(false);
  const bottomPadding = useBottomSheetPadding(24);

  const toggleInvite = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setInviteExpanded((v) => !v);
  };

  const handleCopyCode = () => {
    Clipboard.setString(inviteCode);
    dialog.alert({ message: t('familyInvite.copied') });
  };

  useEffect(() => {
    initCode();
  }, []);

  const initCode = async () => {
    let code = await AsyncStorage.getItem('onboarding_invite_code_generated');
    if (!code) {
      code = generateInviteCode();
      await AsyncStorage.setItem('onboarding_invite_code_generated', code);
    }
    setInviteCode(code);

    const name = await AsyncStorage.getItem('onboarding_name');
    if (name) setUserName(name);
  };

  const handleShareInvite = async () => {
    try {
      // 공유 문구는 로케일 리소스(shareMessage)로 자동 전환 — 스토어 링크는 리소스에 그대로 병기.
      const inviterName = userName || t('familyInvite.defaultInviter');
      await Share.share({
        message: t('familyInvite.shareMessage', {
          name: inviterName,
          code: formatInviteCode(inviteCode),
        }),
        title: t('familyInvite.shareTitle'),
      });
    } catch {
      dialog.alert({ message: t('familyInvite.shareFailMsg') });
    }
  };

  const handleFinish = async () => {
    setIsSaving(true);
    try {
      // AsyncStorage에서 온보딩 데이터 읽기
      const [
        name,
        role,
        birthYearStr,
        gender,
        diagYearStr,
        medicationsJson,
        notificationsJson,
        medNotifsJson,
        caregiverRelation,
        caregiverLiving,
        joinGroupId,
        joinInviteCode,
      ] = await AsyncStorage.multiGet([
        'onboarding_name',
        'onboarding_role',
        'onboarding_birth_year',
        'onboarding_gender',
        'onboarding_diag_year',
        'onboarding_medications',
        'onboarding_notifications',
        'onboarding_med_notifs',
        'onboarding_relation',
        'onboarding_living',
        'onboarding_group_id',
        'onboarding_invite_code',
      ]).then((pairs) => pairs.map(([, v]) => v));

      // 세션에서 userId / accessToken 획득
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      const accessToken = sessionData?.session?.access_token;

      if (!userId || !accessToken) {
        // 개발 모드 (devSignIn): 실제 세션 없음 → 로컬 상태만 업데이트
        forceCompleteOnboarding();
        return;
      }

      // supabase-js PostgREST가 React Native 새 아키텍처에서 hang하는 버그 우회
      // → 직접 fetch API 사용 (useAuth.ts의 dbFetch와 동일한 방식)
      const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
      const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
      const baseHeaders = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      // users 테이블 업데이트 (보호자이면 caregiver_relation, residence_type 포함)
      const userUpdateData: Record<string, any> = {
        name: name || undefined,
        role: role || undefined,
        birth_year: birthYearStr ? parseInt(birthYearStr, 10) : undefined,
        gender: gender || undefined,
        diagnosis_year: diagYearStr ? parseInt(diagYearStr, 10) : undefined,
        onboarding_done: true,
        notification_enabled: true,
      };
      if (role === 'caregiver') {
        if (caregiverRelation) userUpdateData.caregiver_relation = caregiverRelation;
        if (caregiverLiving) userUpdateData.residence_type = caregiverLiving;
      }
      // 그룹이 없는 보호자 단독 가입(환자 코드 미입력)은 group_id가 없으므로 멤버 INSERT를 건너뛰고
      // 온보딩을 정상 완료시킨다. (보호자는 환자 코드를 나중에 입력 가능 — 그룹 없이도 가입 완료돼야 정상)
      const resolvedJoinGroupId = joinGroupId?.trim() || null;
      const resolvedJoinCode = joinInviteCode?.trim() || null;
      // ⚠️ 코드로 합류하는 경로는 patient_group_id 를 여기서 미리 세팅하지 않는다.
      //   방향-무관 안전 RPC(join_family_by_code)가 멤버십+denorm을 서버에서 원자적으로 처리하고,
      //   환자2명/환자 이동 위험을 서버에서 막는다. (denorm 선세팅 시 멤버 INSERT 실패하면 불일치 발생)
      //   코드가 없고 group_id만 있는 구버전 폴백 경로에서만 denorm 선세팅 유지.
      if (resolvedJoinGroupId && !resolvedJoinCode) {
        userUpdateData.patient_group_id = resolvedJoinGroupId;
      }
      // 화면 전환 직후 메모리 user에 즉시 반영할 최종 그룹 id.
      // 환자 본인이 그룹을 새로 생성하는 경로(아래)에서는 newGroupId로 갱신된다.
      let finalGroupId: string | null = resolvedJoinGroupId;

      const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
        method: 'PATCH',
        headers: { ...baseHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify(userUpdateData),
      });
      if (!updateRes.ok) {
        const errText = await updateRes.text();
        throw new Error(`users 업데이트 실패: ${updateRes.status} ${errText}`);
      }

      // 환자 본인 온보딩 완료 시: patient_groups 생성 + 자신을 멤버로 추가 (초대코드 저장)
      // joinGroupId가 없다는 것은 다른 그룹에 합류하지 않았다는 의미 = 자신이 그룹 생성자
      if (role === 'patient' && !resolvedJoinGroupId && inviteCode) {
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        // patient_groups INSERT
        const groupRes = await fetch(`${SUPABASE_URL}/rest/v1/patient_groups`, {
          method: 'POST',
          headers: { ...baseHeaders, 'Prefer': 'return=representation' },
          body: JSON.stringify({
            invite_code: inviteCode,
            invite_code_expires_at: expiresAt,
          }),
        });
        if (groupRes.ok) {
          const groupData = await groupRes.json();
          const newGroupId = Array.isArray(groupData) ? groupData[0]?.id : groupData?.id;
          if (newGroupId) {
            finalGroupId = newGroupId;
            // users.patient_group_id 업데이트
            await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
              method: 'PATCH',
              headers: { ...baseHeaders, 'Prefer': 'return=minimal' },
              body: JSON.stringify({ patient_group_id: newGroupId }),
            });
            // patient_group_members에 환자 본인 추가 (실패 시 throw → 멤버 누락 방지)
            await ensureGroupMember(SUPABASE_URL, baseHeaders, newGroupId, userId, 'patient');
          }
        } else {
          const errText = await groupRes.text();
          console.warn('[FamilyInviteScreen] patient_groups 생성 오류 (계속 진행):', errText);
        }
      }

      // 초대 코드로 가입한 경우 → 방향-무관 안전 RPC로 합류 처리.
      //   서버가 4-사실 판정 후 멤버십+denorm(users.patient_group_id)을 원자적으로 갱신하고,
      //   환자2명/환자 이동 위험을 막는다. 온보딩 시점엔 갈아타기(need_confirm) 대상이 없으므로
      //   force=true 로 호출(기존 임시그룹 없음·신규 가입자라 안전).
      if (resolvedJoinCode && role) {
        const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/join_family_by_code`, {
          method: 'POST',
          headers: baseHeaders,
          body: JSON.stringify({ p_code: resolvedJoinCode, p_force: true }),
        });
        if (rpcRes.ok) {
          const rpcResult: { ok?: boolean; code?: string; message?: string } = await rpcRes.json();
          if (rpcResult?.ok) {
            // 서버가 denorm을 갱신했으므로 finalGroupId를 그룹 id로 확정.
            finalGroupId = resolvedJoinGroupId;
          } else if (rpcResult?.code === 'two_patients') {
            // 환자 2명 → 명확히 안내하고 그룹 합류 없이 단독 가입 완료(데이터 안전 우선).
            finalGroupId = null;
            await dialog.alert({
              title: t('familyInvite.twoPatientsTitle'),
              message: rpcResult.message ?? t('familyInvite.twoPatientsMsg'),
            });
          } else {
            // already_member 등 → finalGroupId 유지(이미 같은 그룹일 수 있음). 안내만 생략.
            console.warn('[FamilyInviteScreen] join_family_by_code 비정상 결과:', rpcResult);
          }
        } else {
          const errText = await rpcRes.text().catch(() => '');
          console.warn('[FamilyInviteScreen] join_family_by_code 실패 (계속 진행):', rpcRes.status, errText);
          finalGroupId = null;
        }
      } else if (resolvedJoinGroupId && role) {
        // 구버전 폴백: 코드 없이 group_id만 있는 경우 → 기존 방식(멤버 직접 추가).
        // (이 멤버 행이 누락되면 RLS is_same_patient_group()이 항상 false가 되어
        //  같은 그룹 가족의 이름·정보가 전부 차단되는 치명적 버그 발생 → 조용히 무시 금지)
        await ensureGroupMember(SUPABASE_URL, baseHeaders, resolvedJoinGroupId, userId, role);
      }

      // 모든 DB INSERT 완료 후 로컬 상태 반영 (화면 전환은 여기서부터)
      // patient_group_id 도 함께 넘겨, 홈 진입 직후 "가족 연동 안내 팝업"이 stale(null) 값을
      // 보고 잘못 뜨는 레이스 컨디션을 방지한다.
      forceCompleteOnboarding(finalGroupId);

      // 알림 설정 반영: 온보딩에서 설정한 값을 settings_med_notifs + DB med_notif_prefs에 저장
      // (§13-2 옵션1) NotificationSetupScreen이 추천 MedNotif[]를 onboarding_med_notifs에
      // 무손실로 저장하므로, 그 값을 그대로 통과시킨다(after30/after2h 하드코딩 브리지 제거).
      // onboarding_med_notifs 부재 시(구버전 호환) onboarding_notifications에서 변환 fallback.
      try {
        let medNotifs: Array<{ id: string; minutes: number; enabled: boolean }> | null = null;
        if (medNotifsJson) {
          const parsed = JSON.parse(medNotifsJson);
          if (Array.isArray(parsed) && parsed.length > 0) medNotifs = parsed;
        }
        if (!medNotifs && notificationsJson) {
          // 구버전 호환 fallback (onboarding_med_notifs 없는 기존 데이터)
          const notifSettings: Record<string, boolean> = JSON.parse(notificationsJson);
          medNotifs = [
            { id: '2', minutes: 30,  enabled: notifSettings.after30 ?? true },
            { id: '3', minutes: 120, enabled: notifSettings.after2h ?? true },
          ];
        }
        if (medNotifs && medNotifs.length > 0) {
          // AsyncStorage 무손실 저장
          await AsyncStorage.setItem('settings_med_notifs', JSON.stringify(medNotifs));
          // DB med_notif_prefs에도 무손실 반영 (SettingsContext와 동일한 fetch 패턴)
          await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
            method: 'PATCH',
            headers: { ...baseHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ med_notif_prefs: medNotifs }),
          }).catch((e) => console.warn('[FamilyInviteScreen] med_notif_prefs 저장 오류:', e));
        }
      } catch (parseErr) {
        console.warn('[FamilyInviteScreen] med notifs 브리지 파싱 오류:', parseErr);
      }

      // [근본 수정] track_intervals 기본값용 notifMinutes — onboarding_med_notifs에서 enabled 분 추출.
      // (없으면 ensurePatientDoseSlots 헬퍼가 [30,120] 기본값을 사용한다.)
      let notifMinutes: number[] | null = null;
      try {
        if (medNotifsJson) {
          const parsedNotifs = JSON.parse(medNotifsJson);
          if (Array.isArray(parsedNotifs)) {
            notifMinutes = parsedNotifs
              .filter((n: any) => n && n.enabled !== false && typeof n.minutes === 'number' && n.minutes > 0)
              .map((n: any) => n.minutes);
          }
        }
      } catch {
        notifMinutes = null;
      }

      // [근본 수정] 환자 dose_slots 기본 4슬롯 보장 — 약 등록 여부와 무관하게 항상.
      // 신규 환자가 약을 한 개도 안 넣고 온보딩을 끝내면 dose_slots가 0개로 시작해
      // 복용/추적 기록이 게이트에 걸리고, 슬롯 추가 화면에서도 pid가 안 잡히는 악순환이 발생한다.
      // meal_schedules 미설정 → 헬퍼가 기본 4슬롯 시각(08/12/18/22) 사용. 멱등·실패해도 throw 안 함.
      // 보호자(caregiver)는 환자가 아니므로 호출하지 않는다(연동 환자 슬롯은 환자 본인 가입 시 보장).
      // 이 호출은 아래 medications 배선(syncMedicationDoseSlots)의 선행조건(환자 슬롯 보장)도 겸한다.
      if (role === 'patient') {
        await ensurePatientDoseSlots(userId, null, undefined, notifMinutes);
      }

      // medications 저장 (환자 본인 또는 보호자가 대신 입력한 경우 모두 저장)
      // 보호자가 온보딩 중 약 데이터를 입력했을 때도 medications 테이블에 저장
      // patient_id: 환자는 자신의 userId, 보호자는 joinGroupId가 있으면 그룹의 환자 ID를 찾아야 하지만
      // 온보딩 시점엔 아직 그룹 환자 ID를 모르므로 일단 보호자 userId로 임시 저장 후
      // 추후 가족 연동 시 재매핑 필요 → 단순화: 온보딩 시 medications는 항상 자신의 userId로 저장
      if (medicationsJson) {
        const meds: Array<{
          name: string;
          dosage?: string;
          times: string[];
          meal_schedules?: Record<string, string>;
          drugInfo?: { itemImage?: string; itemSeq?: string };
        }> = JSON.parse(medicationsJson);

        if (meds.length > 0) {
          // [5단계 dual-write] medications 영속화 직후 dose_slots/medication_dose_slots 배선.
          // 순서: ensurePatientDoseSlots(선행) → medications POST(representation)
          //       → 각 약 syncMedicationDoseSlots → invalidate.
          // 환자(role==='patient')는 위 블록에서 이미 슬롯을 보장했으므로 멱등 호출이 생략된다.
          // 보호자가 환자 약을 대신 입력한 경로는 위 블록을 안 타므로, 약 배선의 선행조건(슬롯 보장)을
          // 여기서 보장한다(기존 동작 유지 — 멱등이라 중복돼도 안전).
          if (role !== 'patient') {
            await ensurePatientDoseSlots(userId, null, undefined, notifMinutes);
          }

          // representation으로 POST해 각 약의 id를 확보 (slot 배정에 필요).
          const medRes = await fetch(`${SUPABASE_URL}/rest/v1/medications`, {
            method: 'POST',
            headers: { ...baseHeaders, 'Prefer': 'return=representation' },
            body: JSON.stringify(meds.map((med) => ({
              patient_id: userId,
              name: med.name,
              dosage: med.dosage ?? null,
              meal_times: med.times,
              meal_schedules: med.meal_schedules ?? {},
              scheduled_times: [],
              drug_code: null,
              drug_image_url: med.drugInfo?.itemImage || null,
              item_seq: med.drugInfo?.itemSeq || null,
              is_active: true,
            }))),
          });
          if (!medRes.ok) {
            const errText = await medRes.text();
            console.warn(`[FamilyInviteScreen] medications 저장 실패 (계속 진행): ${medRes.status} ${errText}`);
          } else {
            // representation 응답: 삽입된 약 행 배열(요청 meds와 동일 순서). id ↔ meal_times 매핑 후 슬롯 배정.
            try {
              const insertedRaw = await medRes.json();
              const inserted: Array<{ id?: string }> = Array.isArray(insertedRaw) ? insertedRaw : [];
              for (let i = 0; i < inserted.length; i++) {
                const medId = inserted[i]?.id;
                const mealTimes = (meds[i]?.times ?? []) as LegacyMealKey[];
                if (medId) {
                  await syncMedicationDoseSlots(userId, medId, mealTimes);
                }
              }
            } catch (mapErr) {
              console.warn('[FamilyInviteScreen] dose_slot 배정 파싱 오류 (계속 진행):', mapErr);
            }
          }

          // 캐시 무효화 — 직후 읽기 경로(useDoseSlots)가 새 슬롯/배정을 보게.
          invalidateDoseSlotsCache(userId);
        }
      }

      // refreshUser로 앱 상태 최종 갱신
      await refreshUser();

      // AsyncStorage 온보딩 키 정리
      await AsyncStorage.multiRemove([
        'onboarding_role',
        'onboarding_name',
        'onboarding_birth_year',
        'onboarding_gender',
        'onboarding_diag_year',
        'onboarding_medications',
        'onboarding_notifications',
        'onboarding_med_notifs',
        'onboarding_invite_code_generated',
        'onboarding_relation',
        'onboarding_living',
        'onboarding_invite_code',
        'onboarding_group_id',
      ]);
    } catch (e: any) {
      console.error('[FamilyInviteScreen] handleFinish 오류:', e);
      await dialog.alert({
        title: t('familyInvite.saveErrorTitle'),
        message: t('familyInvite.saveErrorMsg') + (e?.message ?? ''),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.backIcon}>←</Text>
          <Text style={styles.backText}>{t('common.back')}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroArea}>
          <Text style={styles.title}>{t('familyInvite.title')}</Text>
          <Text style={styles.subtitle}>
            {t('familyInvite.subtitle')}
          </Text>
        </View>

        {/* 가족 초대 — 펼친 내용 (트리거는 하단 "가족 초대하기" 버튼) */}
        {inviteExpanded && (
          <View style={styles.expandedCard}>
            <Text style={styles.guideText}>{t('familyInvite.guideText')}</Text>

            {/* 초대 번호 박스 */}
            <View style={styles.codeBox}>
              <Text style={styles.codeNumber}>{formatInviteCode(inviteCode)}</Text>
              <TouchableOpacity
                style={styles.copyBtn}
                onPress={handleCopyCode}
                activeOpacity={0.7}
              >
                <Text style={styles.copyBtnText}>{t('familyInvite.copyBtn')}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.codeExpiry}>{t('familyInvite.expiry')}</Text>

            {/* 사용법 단계 */}
            <View style={styles.steps}>
              <Text style={styles.step}>{t('familyInvite.step1')}</Text>
              <Text style={styles.step}>{t('familyInvite.step2')}</Text>
            </View>

            {/* 번호 공유 (보조) — 국내: 카카오 노란 버튼 / 해외: 중립 버튼 */}
            <TouchableOpacity
              style={[overseas ? styles.shareBtnNeutral : styles.kakaoBtn, isSaving && styles.disabledBtn]}
              onPress={handleShareInvite}
              activeOpacity={0.85}
              disabled={isSaving}
            >
              <Text style={overseas ? styles.shareBtnNeutralText : styles.kakaoBtnText}>{t('familyInvite.shareBtn')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* 하단 버튼: 바로 시작하기(메인) + 가족 초대하기(보조) */}
      <View style={[styles.bottomArea, { paddingBottom: bottomPadding }]}>
        <TouchableOpacity
          style={[styles.startBtn, isSaving && styles.disabledBtn]}
          onPress={handleFinish}
          activeOpacity={0.85}
          disabled={isSaving}
        >
          <Text style={styles.startBtnText}>{t('familyInvite.startBtn')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.inviteBtn, isSaving && styles.disabledBtn]}
          onPress={toggleInvite}
          activeOpacity={0.85}
          disabled={isSaving}
        >
          <Text style={styles.inviteBtnText}>{t('familyInvite.inviteBtn')}</Text>
        </TouchableOpacity>
      </View>
      <BrandProgressOverlay
        visible={isSaving}
        title={t('familyInvite.savingTitle')}
        minVisibleMs={500}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignSelf: 'flex-start',
  },
  backIcon: {
    fontSize: 22,
    color: Colors.text,
  },
  backText: {
    fontSize: 18,
    color: Colors.text,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  heroArea: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    color: Colors.textSub,
    lineHeight: 28,
    textAlign: 'center',
  },

  /* 펼친 보조 카드 */
  expandedCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  guideText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 12,
  },
  codeBox: {
    backgroundColor: Colors.light,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.primary,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  codeNumber: {
    fontSize: 38,
    fontWeight: '800',
    color: Colors.dark,
    letterSpacing: 4,
    marginBottom: 12,
  },
  copyBtn: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  copyBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.primary,
  },
  codeExpiry: {
    fontSize: 14,
    color: Colors.textHint,
    marginTop: 8,
    textAlign: 'center',
  },
  steps: {
    gap: 10,
    marginTop: 20,
    marginBottom: 20,
  },
  step: {
    fontSize: 16,
    color: Colors.textSub,
    lineHeight: 24,
  },
  kakaoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE500',
    borderRadius: 12,
    minHeight: 56,
    gap: 10,
  },
  kakaoBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#3C1E1E',
  },
  /* 해외용 중립 공유 버튼 (카카오 노란 스타일 대체) */
  shareBtnNeutral: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.primary,
    minHeight: 56,
    gap: 10,
  },
  shareBtnNeutralText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.primary,
  },

  /* 메인 CTA */
  bottomArea: {
    paddingHorizontal: 24,
    paddingTop: 16,
    gap: 12,
  },
  startBtn: {
    minHeight: 56,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtnText: {
    fontSize: 18,
    color: Colors.white,
    fontWeight: '700',
  },
  inviteBtn: {
    minHeight: 56,
    borderRadius: 12,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteBtnText: {
    fontSize: 18,
    color: Colors.text,
    fontWeight: '700',
  },
  disabledBtn: {
    opacity: 0.5,
  },
});

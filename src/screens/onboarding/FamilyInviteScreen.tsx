import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Share,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { Colors } from '../../constants/colors';
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

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function FamilyInviteScreen() {
  const navigation = useNavigation<Nav>();
  const { refreshUser, forceCompleteOnboarding } = useAuth();
  const dialog = useDialog();
  const [inviteCode, setInviteCode] = useState('');
  const [userName, setUserName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { bottom: bottomInset } = useSafeAreaInsets();

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

  const handleKakaoShare = async () => {
    try {
      await Share.share({
        message: `💊 파킨온 - 파킨슨 케어 앱\n\n${userName || '가족'}님이 파킨온에 초대했어요!\n\n🔑 초대 코드: ${inviteCode}\n앱 설치 후 초대 코드를 입력하면 가족으로 등록돼요.\n\n파킨온은 파킨슨 환자와 가족이 함께 사용하는 건강 관리 앱이에요.\n✅ 약 복용 알림 & 기록\n✅ 약효 추적 (복용 후 상태 체크)\n✅ 몸 상태·운동 기록\n✅ 가족과 실시간 공유\n\n📱 구글 플레이에서 설치하기\nhttps://play.google.com/store/apps/details?id=com.ourmine.parkinon`,
        title: '파킨온 가족 초대',
      });
    } catch {
      dialog.alert({ message: '공유하기에 실패했어요. 코드를 직접 전달해주세요.' });
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
      if (resolvedJoinGroupId) {
        userUpdateData.patient_group_id = resolvedJoinGroupId;
      }

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

      // 초대 코드로 가입한 경우 → patient_group_members에도 반드시 추가
      // (이 멤버 행이 누락되면 RLS is_same_patient_group()이 항상 false가 되어
      //  같은 그룹 가족의 이름·정보가 전부 차단되는 치명적 버그 발생 → 조용히 무시 금지)
      if (resolvedJoinGroupId && role) {
        await ensureGroupMember(SUPABASE_URL, baseHeaders, resolvedJoinGroupId, userId, role);
      }

      // 모든 DB INSERT 완료 후 로컬 상태 반영 (화면 전환은 여기서부터)
      forceCompleteOnboarding();

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
          // 순서: ensurePatientDoseSlots → medications POST(representation) → 각 약 syncMedicationDoseSlots → invalidate.
          // 신규 온보딩 환자는 dose_slots가 0개이므로, 약 배정 전에 환자 슬롯 4개를 먼저 보장해야 한다.
          // 헬퍼는 멱등·실패해도 throw 안 함 → 온보딩 흐름을 막지 않는다.

          // track_intervals 기본값용 notifMinutes — onboarding_med_notifs에서 enabled 분 추출(있으면).
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

          // 환자 dose_slots 보장 (meal_schedules 미설정 → 헬퍼가 기본 4슬롯 시각 사용).
          await ensurePatientDoseSlots(userId, null, undefined, notifMinutes);

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
        title: '저장 오류',
        message: '정보 저장 중 문제가 발생했어요. 다시 시도해 주세요.\n\n' + (e?.message ?? ''),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const codeChars = inviteCode.split('');

  return (
    <SafeAreaView style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.backIcon}>←</Text>
          <Text style={styles.backText}>뒤로</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroArea}>
          <Text style={styles.title}>가족을 초대해드릴게요</Text>
          <Text style={styles.subtitle}>
            초대 코드를 가족에게 전달하면{'\n'}서로 연결할 수 있어요
          </Text>
        </View>

        {/* 초대 코드 카드 */}
        <View style={styles.codeCard}>
          <Text style={styles.codeCardTitle}>초대 코드</Text>

          <View style={styles.codeRow}>
            {codeChars.map((char, i) => (
              <View key={i} style={styles.codeBox}>
                <Text style={styles.codeChar}>{char}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.codeExpiry}>24시간 동안 유효해요</Text>
        </View>

        {/* 안내 */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>이렇게 사용해요</Text>
          <View style={styles.infoSteps}>
            <Text style={styles.infoStep}>1. 가족이 파킨온 앱을 설치해요</Text>
            <Text style={styles.infoStep}>2. 회원가입 후 초대 코드를 입력해요</Text>
            <Text style={styles.infoStep}>3. 서로의 건강 정보를 함께 볼 수 있어요</Text>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.bottomArea, { paddingBottom: 40 + bottomInset }]}>
        <TouchableOpacity
          style={[styles.kakaoBtn, isSaving && styles.disabledBtn]}
          onPress={handleKakaoShare}
          activeOpacity={0.85}
          disabled={isSaving}
        >
          <Text style={styles.kakaoBtnText}>카카오톡으로 공유하기</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.closeBtn, isSaving && styles.disabledBtn]}
          onPress={handleFinish}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Text style={styles.closeBtnText}>시작하기 →</Text>
          )}
        </TouchableOpacity>
      </View>
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
  codeCard: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: Colors.light,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  codeCardTitle: {
    fontSize: 16,
    color: Colors.textSub,
    marginBottom: 20,
    fontWeight: '600',
  },
  codeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  codeBox: {
    width: 46,
    height: 58,
    borderRadius: 10,
    backgroundColor: Colors.light,
    borderWidth: 2,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeChar: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.dark,
    letterSpacing: 0,
  },
  codeExpiry: {
    fontSize: 14,
    color: Colors.textHint,
    marginTop: 4,
  },
  infoCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 14,
  },
  infoSteps: {
    gap: 12,
  },
  infoStep: {
    fontSize: 16,
    color: Colors.textSub,
    lineHeight: 24,
  },
  bottomArea: {
    paddingHorizontal: 24,
    gap: 12,
  },
  kakaoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE500',
    borderRadius: 12,
    minHeight: 60,
    gap: 10,
  },
  kakaoBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#3C1E1E',
  },
  closeBtn: {
    minHeight: 60,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 18,
    color: Colors.white,
    fontWeight: '700',
  },
  disabledBtn: {
    opacity: 0.5,
  },
});

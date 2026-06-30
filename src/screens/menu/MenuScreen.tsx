import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { MenuStackParamList } from '../../navigation/MenuNavigator';
import { TopBar } from '../../components/common/TopBar';
import { BrandProgressOverlay } from '../../components/common/BrandProgressOverlay';
import { useAuth } from '../../context/AuthContext';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { supabase } from '../../lib/supabase';
import { navigateTo } from '../../navigation/navigationRef';
import { useDialog } from '../../context/DialogContext';
import { ensureNotGuest } from '../../utils/guestGuard';
import { MEASUREMENT_FEATURE_ENABLED } from '../../constants/featureFlags';
import { useScrollTopOnTabPress } from '../../hooks/useScrollTopOnTabPress';

type NavigationProp = StackNavigationProp<MenuStackParamList, 'MenuHome'>;
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type MaterialCommunityIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface MenuItem {
  key: string;
  icon: IoniconName | MaterialCommunityIconName;
  /** 아이콘 세트. 기본은 Ionicons. 톱바와 일관성을 위해 일기 항목만 MaterialCommunityIcons 사용. */
  iconSet?: 'ionicons' | 'material-community';
  label: string;
  desc: string;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

/** 환자 본인일 때만 노출되는 측정 기록 항목 */
const PATIENT_ONLY_MEASUREMENT_ITEM: MenuItem = {
  key: 'MeasurementRecords',
  icon: 'stats-chart-outline',
  label: '컨디션 측정 기록 보기',
  desc: '손가락·반응속도 측정 기록을 확인해요',
};

/** 보호자 모드: 환자 측정 1회 이상일 때만 '기록' 섹션 최상단에 추가되는 항목 (Phase 5A).
 *  라벨/설명은 환자 이름으로 동적 생성(아래 menuSections). '환자' 일반어 노출 금지 — 이름+님 사용. */
const CAREGIVER_MEASUREMENT_VIEW_KEY = 'CaregiverMeasurementView';

const MENU_SECTIONS: MenuSection[] = [
  {
    title: '기록',
    items: [
      {
        key: 'Diary',
        icon: 'notebook-edit-outline',
        iconSet: 'material-community',
        label: '파킨온 일기',
        desc: '하루하루 종합 일기를 써요',
      },
      {
        key: 'Records',
        icon: 'bar-chart-outline',
        label: '작성 기록 보기',
        desc: '약복용·약효추적 기록을 확인해요',
      },
      {
        key: 'VideoList',
        icon: 'videocam-outline',
        label: '영상 기록 보기',
        desc: '몸상태 촬영한 기록을 확인해요',
      },
      {
        key: 'MedicalRecordList',
        icon: 'stethoscope',
        iconSet: 'material-community',
        label: '진료 기록',
        desc: '병원 진료 기록을 확인해요',
      },
    ],
  },
  {
    title: '관리',
    items: [
      {
        key: 'FamilyLink',
        icon: 'people-outline',
        label: '가족 연동',
        desc: '__FAMILY_LINK_DESC__',
      },
      {
        key: 'MyMeds',
        icon: 'pill',
        iconSet: 'material-community',
        label: '복용약 관리',
        desc: '드시는 약을 등록하고 관리해요',
      },
      {
        key: 'DoseSlots',
        icon: 'alarm-outline',
        label: '복용시간 설정·알림',
        desc: '약 드시는 시간과 알림을 설정해요',
      },
      {
        key: 'Settings',
        icon: 'notifications-outline',
        label: '그 밖의 알림',
        desc: '미복용·운동 등 그 밖의 알림을 설정해요',
      },
      {
        key: 'AlarmSoundSettings',
        icon: 'mic-outline',
        label: '알림음 관리',
        desc: '알림음을 직접 등록하고 관리해요',
      },
    ],
  },
  {
    title: '기타',
    items: [
      {
        key: 'BlockedUsers',
        icon: 'person-remove-outline',
        label: '차단한 사용자 관리',
        desc: '차단한 사용자를 확인하고 해제해요',
      },
      {
        key: 'Terms',
        icon: 'document-text-outline',
        label: '이용약관',
        desc: '서비스 이용약관을 확인해요',
      },
      {
        key: 'Privacy',
        icon: 'lock-closed-outline',
        label: '개인정보처리방침',
        desc: '개인정보 처리방침을 확인해요',
      },
    ],
  },
];

export function MenuScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { user, signOut, refreshUser } = useAuth();
  const { unreadCount } = useNotificationBadge();
  const dialog = useDialog();

  // 탭 버튼 누를 때 항상 맨 위로
  const scrollRef = React.useRef<ScrollView>(null);
  useScrollTopOnTabPress(scrollRef);

  // 화면 포커스 시 사용자 정보 갱신 (ProfileEdit 후 이름 즉시 반영)
  useFocusEffect(
    React.useCallback(() => {
      refreshUser();
    }, [refreshUser])
  );

  // 프로필 카드 보조문구: 보호자는 '보호자', 환자는 진단연도(있으면)만 표시('환자' 글자 노출 안 함).
  const profileSub =
    user?.role === 'caregiver'
      ? '보호자'
      : user?.diagnosis_year
        ? `${user.diagnosis_year}년 진단`
        : '';

  // Phase 5A — 보호자: 환자의 측정이 1회라도 있는지 체크 → 진입점 노출 가드
  const [hasPatientMeasurement, setHasPatientMeasurement] = React.useState<boolean>(false);
  // 보호자 모드에서 같은 그룹 환자의 user_id / 이름 — 측정 기록 화면으로 넘길 때 사용.
  const [patientId, setPatientId] = React.useState<string | null>(null);
  const [patientName, setPatientName] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      const isCaregiverLinked =
        user?.role === 'caregiver' && !!user?.patient_group_id;
      if (!isCaregiverLinked) {
        setHasPatientMeasurement(false);
        setPatientId(null);
        setPatientName(null);
        return;
      }
      (async () => {
        try {
          // 같은 group의 환자 user_id + 이름 조회 (users join)
          const { data: row } = await supabase
            .from('patient_group_members')
            .select('user_id, users:user_id ( name )')
            .eq('group_id', user!.patient_group_id!)
            .eq('role', 'patient')
            .maybeSingle();
          const pid = (row as any)?.user_id as string | undefined;
          const pname = (row as any)?.users?.name as string | undefined;
          if (!cancelled) {
            setPatientId(pid ?? null);
            setPatientName(pname ?? null);
          }
          if (!pid) {
            if (!cancelled) setHasPatientMeasurement(false);
            return;
          }
          // 측정 1건 이상 존재 여부만 확인 — head: true + count로 비용 최소화
          const { count } = await supabase
            .from('measurements')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', pid)
            .is('deleted_at', null);
          if (!cancelled) setHasPatientMeasurement((count ?? 0) > 0);
        } catch (e) {
          // RLS/네트워크 실패 시 조용히 false — 진입점 미노출 (안전 디폴트)
          if (!cancelled) setHasPatientMeasurement(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [user?.role, user?.patient_group_id])
  );

  // '기록' 섹션 순서 규칙 (메뉴 맨 위):
  //   1) 📊 기록 보기 (Records)
  //   2) 📊 컨디션 측정 기록 보기 (환자 전용) / 환자 컨디션 보기 (보호자 + 측정 1회+)
  //   3) 📹 영상 기록 보기 (VideoList)
  // 환자/보호자 노출 조건은 기존 유지. 위치만 '기록 보기'와 '영상 기록 보기' 사이로 변경.
  const menuSections = React.useMemo<MenuSection[]>(() => {
    // 보호자: '복용시간 설정·알림'은 보호자 알림 설정 화면 하단에서 환자 대신 설정하므로 메뉴에선 숨김.
    // 또한 보호자의 'Settings'(그 밖의 알림) 항목은 보호자용 알림 설정 화면(환자 알림 수정 포함)이므로
    // label/desc를 보호자 문구로 교체한다(환자 본인은 기존 '그 밖의 알림' 유지).
    const base =
      user?.role === 'caregiver'
        ? MENU_SECTIONS.map((section) => ({
            ...section,
            items: section.items
              .filter((i) => i.key !== 'DoseSlots')
              .map((i) =>
                i.key === 'Settings'
                  ? {
                      ...i,
                      label: '보호자용 알림',
                      desc: '미복용·약효추적·운동 등 알림을 설정해요',
                    }
                  : i,
              ),
          }))
        : MENU_SECTIONS;
    // 컨디션 측정 기능 숨김 시 측정 관련 메뉴 항목(환자/보호자) 모두 비노출.
    if (!MEASUREMENT_FEATURE_ENABLED) return base;
    const isPatient = user?.role === 'patient';
    const isCaregiverWithData = user?.role === 'caregiver' && hasPatientMeasurement;
    if (!isPatient && !isCaregiverWithData) return base;
    // 보호자 항목 라벨/설명 — 환자 이름+님 사용. 이름 로드 전이면 잠시 '환자' fallback.
    const pName = patientName ?? '환자';
    const caregiverItem: MenuItem = {
      key: CAREGIVER_MEASUREMENT_VIEW_KEY,
      icon: 'hand-left-outline',
      label: `${pName}님 컨디션 보기`,
      desc: `${pName}님의 손가락·반응속도 결과를 확인해요`,
    };
    return base.map((section) => {
      if (section.title !== '기록') return section;
      const extraItem = isPatient
        ? PATIENT_ONLY_MEASUREMENT_ITEM
        : caregiverItem;
      // 'Records'(기록 보기) 다음, 'VideoList'(영상 기록 보기) 앞 위치에 삽입
      const recordsIdx = section.items.findIndex((i) => i.key === 'Records');
      const insertAt = recordsIdx >= 0 ? recordsIdx + 1 : 0;
      const nextItems = [
        ...section.items.slice(0, insertAt),
        extraItem,
        ...section.items.slice(insertAt),
      ];
      return { ...section, items: nextItems };
    });
  }, [user?.role, hasPatientMeasurement, patientName]);

  // 가족 연동 설명 텍스트 (고정 문구)
  const familyLinkDesc = '가족을 초대하고 함께 관리해요';

  const handleMenuPress = async (key: string) => {
    // 약관·개인정보처리방침은 게스트도 열람 가능. 그 외 서버 데이터가 필요한 항목은 게스트 차단.
    const guestAllowed = key === 'Terms' || key === 'Privacy' || key === 'Settings';
    if (!guestAllowed && (await ensureNotGuest(user, dialog, { signOut }))) return;

    if (key === 'Records') {
      navigation.navigate('Records');
    } else if (key === 'Diary') {
      // 일기 화면은 RootNavigator 스택에 있음
      navigateTo('Diary');
    } else if (key === 'VideoList') {
      navigation.navigate('VideoList');
    } else if (key === 'Settings') {
      navigation.navigate('Settings');
    } else if (key === 'MyMeds') {
      navigation.navigate('MedicationManage', { mode: 'meds' });
    } else if (key === 'DoseSlots') {
      navigation.navigate('MedicationManage', { mode: 'slots' });
    } else if (key === 'FamilyLink') {
      navigation.navigate('FamilyLink');
    } else if (key === 'Terms') {
      navigation.navigate('Terms');
    } else if (key === 'Privacy') {
      navigation.navigate('Privacy');
    } else if (key === 'MedicalRecordList') {
      navigation.navigate('MedicalRecordList');
    } else if (key === 'BlockedUsers') {
      navigation.navigate('BlockedUsers');
    } else if (key === 'AlarmSoundSettings') {
      // 알림음 설정 화면 — MenuNavigator(기록·관리 탭) 스택 내 이동 → 탭바 유지
      navigation.navigate('AlarmSoundSettings');
    } else if (key === 'MeasurementRecords') {
      // 환자 본인 측정 기록 보기 — params 없이 본인 데이터.
      navigateTo('MeasurementRecords');
    } else if (key === CAREGIVER_MEASUREMENT_VIEW_KEY) {
      // 보호자: 환자가 보는 것과 동일한 측정 기록 화면을 환자 데이터로 관람(읽기 전용).
      if (!patientId) return;
      navigateTo('MeasurementRecords', { patientId, patientName: patientName ?? undefined });
    }
  };

  const handleLogout = async () => {
    const ok = await dialog.confirm({
      title: '로그아웃',
      message: '정말 로그아웃 하시겠어요?',
      confirmText: '로그아웃',
      cancelText: '취소',
      destructive: true,
    });
    if (!ok) return;
    signOut();
  };

  const handleWithdraw = async () => {
    if (await ensureNotGuest(user, dialog, { signOut })) return;
    const ok = await dialog.confirm({
      title: '회원 탈퇴',
      message: '탈퇴하시면 모든 기록이 삭제돼요.\n정말 탈퇴하시겠어요?',
      confirmText: '탈퇴하기',
      cancelText: '취소',
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      // 세션 토큰 확보
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('세션 없음');

      // delete-account Edge Function 호출
      // (supabase-js PostgREST hang 버그 우회 + auth.admin.deleteUser 권한 필요)
      const res = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/delete-account`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!res.ok) {
        const body = await res.text();
        console.error('[handleWithdraw] edge function 오류:', res.status, body);
        throw new Error('탈퇴 실패');
      }

      // 무거운 정리 작업이 끝났으니 로딩 오버레이를 내리고 완료 안내
      setDeleting(false);
      // 탈퇴 완료 안내 후 로컬 세션 정리
      await dialog.alert({
        title: '탈퇴 완료',
        message: '계정이 삭제되었습니다.\n이용해 주셔서 감사합니다.',
      });
      // useAuth의 signOut을 사용해 user state를 즉시 null로 만들고
      // 온보딩 임시 입력값(AsyncStorage) 등 사용자별 로컬 데이터를 정리한다.
      // (supabase.auth.signOut()만 호출하면 user state가 비동기로 늦게 갱신되어
      //  RootNavigator가 OnboardingGuest(로그인)가 아닌 온보딩 중간 화면으로 빠질 수 있음)
      await signOut();
    } catch (e: any) {
      setDeleting(false);
      dialog.alert({ title: '오류', message: '탈퇴 처리 중 문제가 생겼어요. 다시 시도해주세요.' });
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar
        showParkinon
        showDiary
        onDiaryPress={() => navigateTo('Diary')}
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
      />

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 프로필 컴팩트 카드 */}
        <TouchableOpacity
          style={styles.profileCard}
          onPress={async () => {
            if (await ensureNotGuest(user, dialog, { signOut })) return;
            navigation.navigate('ProfileEdit');
          }}
          activeOpacity={0.85}
        >
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{user?.name ?? '사용자'}</Text>
            {profileSub ? <Text style={styles.profileRole}>{profileSub}</Text> : null}
          </View>
          <View style={styles.profileEditRow}>
            <Text style={styles.profileEditText}>프로필 수정</Text>
            <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
          </View>
        </TouchableOpacity>

        {/* 섹션별 메뉴 */}
        {menuSections.map((section) => (
          <View key={section.title}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{section.title.toUpperCase()}</Text>
            </View>
            <View style={styles.sectionCard}>
              {section.items.map((item, index) => (
                <View key={item.key}>
                  <TouchableOpacity
                    style={styles.menuRow}
                    onPress={() => handleMenuPress(item.key)}
                    activeOpacity={0.75}
                  >
                    <View style={[
                      styles.menuIconCircle,
                    ]}>
                      {item.iconSet === 'material-community' ? (
                        <MaterialCommunityIcons
                          name={item.icon as MaterialCommunityIconName}
                          size={28}
                          color={item.key === 'EmergencyContacts' ? '#F44336' : Colors.primary}
                        />
                      ) : (
                        <Ionicons
                          name={item.icon as IoniconName}
                          size={28}
                          color={item.key === 'EmergencyContacts' ? '#F44336' : Colors.primary}
                        />
                      )}
                    </View>
                    <View style={styles.menuTextWrap}>
                      <Text style={styles.menuLabel}>{item.label}</Text>
                      <Text style={styles.menuDesc}>
                        {item.desc === '__FAMILY_LINK_DESC__' ? familyLinkDesc : item.desc}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={22} color={Colors.textHint} />
                  </TouchableOpacity>
                  {index < section.items.length - 1 && (
                    <View style={styles.menuDivider} />
                  )}
                </View>
              ))}
            </View>
          </View>
        ))}

        {/* 계정 섹션 */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderText}>계정</Text>
        </View>
        <View style={styles.sectionCard}>
          <TouchableOpacity
            style={styles.menuRow}
            onPress={handleLogout}
            activeOpacity={0.75}
          >
            <View style={styles.menuIconCircle}>
              <Ionicons name="log-out-outline" size={28} color={Colors.text} />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuLabel}>로그아웃</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={Colors.textHint} />
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          <TouchableOpacity
            style={styles.menuRow}
            onPress={handleWithdraw}
            activeOpacity={0.75}
          >
            <View style={[styles.menuIconCircle, styles.dangerIconCircle]}>
              <Ionicons name="close-circle-outline" size={28} color={Colors.danger} />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={[styles.menuLabel, styles.dangerLabel]}>회원탈퇴</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={Colors.textHint} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      <BrandProgressOverlay
        visible={deleting}
        title="탈퇴 처리 중이에요"
        subtitle="계정을 정리하고 있어요"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },

  scroll: { flex: 1 },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },

  /* 프로필 컴팩트 카드 */
  profileCard: {
    backgroundColor: '#4CAF50',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 70,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 4,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  profileRole: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  profileEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  profileEditText: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
  },

  /* 섹션 헤더 */
  sectionHeader: {
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 4,
    paddingTop: 20,
    paddingBottom: 8,
    zIndex: 1,
  },
  sectionHeaderText: {
    fontSize: 16,
    color: '#666666',
    fontWeight: '600',
    letterSpacing: 0.5,
  },

  /* 섹션 카드 */
  sectionCard: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 4,
  },

  /* 메뉴 행 */
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 72,
  },
  menuDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: 16,
  },
  menuIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  dangerIconCircle: {
    backgroundColor: '#FFF0F0',
  },
  menuTextWrap: {
    flex: 1,
  },
  menuLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 2,
  },
  menuDesc: {
    fontSize: 16,
    color: Colors.textSub,
    lineHeight: 20,
  },
  dangerLabel: {
    color: Colors.danger,
  },
});

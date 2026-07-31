import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { MenuStackParamList } from '../../navigation/MenuNavigator';
import { TopBar } from '../../components/common/TopBar';
import { BrandProgressOverlay } from '../../components/common/BrandProgressOverlay';
import { useAuth } from '../../context/AuthContext';
import { setWithdrawing } from '../../hooks/useAuth';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { supabase } from '../../lib/supabase';
import { navigateTo } from '../../navigation/navigationRef';
import { useDialog } from '../../context/DialogContext';
import { ensureNotGuest } from '../../utils/guestGuard';
import { MEASUREMENT_FEATURE_ENABLED } from '../../constants/featureFlags';
import { useScrollTopOnTabPress } from '../../hooks/useScrollTopOnTabPress';
import { isOverseasLocale } from '../../i18n/detectLocale';
import { useSubscription } from '../../context/SubscriptionContext';
import { AdSlot } from '../../components/common/AdSlot';
import { isPrivacyOptionsRequired, showAdsPrivacyOptions } from '../../lib/ads';

type NavigationProp = StackNavigationProp<MenuStackParamList, 'MenuHome'>;
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type MaterialCommunityIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface MenuItem {
  key: string;
  icon: IoniconName | MaterialCommunityIconName;
  /** 아이콘 세트. 기본은 Ionicons. 톱바와 일관성을 위해 일기 항목만 MaterialCommunityIcons 사용. */
  iconSet?: 'ionicons' | 'material-community';
  /** i18n 키(t()로 렌더). */
  label: string;
  /** i18n 키(t()로 렌더). */
  desc: string;
  /** 라벨/설명 보간 파라미터(예: 환자 이름). */
  labelParams?: Record<string, unknown>;
  descParams?: Record<string, unknown>;
}

interface MenuSection {
  /** i18n 키(t()로 렌더). 섹션 식별에도 사용. */
  title: string;
  items: MenuItem[];
}

/** 환자 본인일 때만 노출되는 측정 기록 항목 */
const PATIENT_ONLY_MEASUREMENT_ITEM: MenuItem = {
  key: 'MeasurementRecords',
  icon: 'stats-chart-outline',
  label: 'menu.measurementPatientLabel',
  desc: 'menu.measurementPatientDesc',
};

/** 보호자 모드: 환자 측정 1회 이상일 때만 '기록' 섹션 최상단에 추가되는 항목 (Phase 5A).
 *  라벨/설명은 환자 이름으로 동적 생성(아래 menuSections). '환자' 일반어 노출 금지 — 이름+님 사용. */
const CAREGIVER_MEASUREMENT_VIEW_KEY = 'CaregiverMeasurementView';

const MENU_SECTIONS: MenuSection[] = [
  {
    title: 'menu.sectionRecords',
    items: [
      {
        key: 'Diary',
        icon: 'notebook-edit-outline',
        iconSet: 'material-community',
        label: 'menu.diaryLabel',
        desc: 'menu.diaryDesc',
      },
      {
        key: 'Records',
        icon: 'bar-chart-outline',
        label: 'menu.recordsLabel',
        desc: 'menu.recordsDesc',
      },
      {
        key: 'VideoList',
        icon: 'videocam-outline',
        label: 'menu.videoListLabel',
        desc: 'menu.videoListDesc',
      },
      {
        key: 'MedicalRecordList',
        icon: 'stethoscope',
        iconSet: 'material-community',
        label: 'menu.medicalRecordLabel',
        desc: 'menu.medicalRecordDesc',
      },
    ],
  },
  {
    title: 'menu.sectionManage',
    items: [
      {
        key: 'FamilyLink',
        icon: 'people-outline',
        label: 'menu.familyLinkLabel',
        desc: 'menu.familyLinkDesc',
      },
      {
        key: 'MyMeds',
        icon: 'pill',
        iconSet: 'material-community',
        label: 'menu.myMedsLabel',
        desc: 'menu.myMedsDesc',
      },
      {
        key: 'DoseSlots',
        icon: 'alarm-outline',
        label: 'menu.doseSlotsLabel',
        desc: 'menu.doseSlotsDesc',
      },
      {
        key: 'Settings',
        icon: 'notifications-outline',
        label: 'menu.settingsLabel',
        desc: 'menu.settingsDesc',
      },
      {
        // 보호자 전용(연동 환자 있을 때) — 환자 알림을 대신 설정하는 별도 화면. 비-보호자는 필터로 숨김.
        key: 'PatientNotifSettings',
        icon: 'people-outline',
        label: 'menu.patientNotifLabel',
        desc: 'menu.patientNotifDesc',
      },
      {
        key: 'AlarmSoundSettings',
        icon: 'mic-outline',
        label: 'menu.alarmSoundLabel',
        desc: 'menu.alarmSoundDesc',
      },
    ],
  },
  {
    title: 'menu.sectionEtc',
    items: [
      {
        key: 'BlockedUsers',
        icon: 'person-remove-outline',
        label: 'menu.blockedUsersLabel',
        desc: 'menu.blockedUsersDesc',
      },
      {
        key: 'Terms',
        icon: 'document-text-outline',
        label: 'menu.termsLabel',
        desc: 'menu.termsDesc',
      },
      {
        key: 'Privacy',
        icon: 'lock-closed-outline',
        label: 'menu.privacyLabel',
        desc: 'menu.privacyDesc',
      },
    ],
  },
];

export function MenuScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp>();
  const { user, signOut, refreshUser } = useAuth();
  const { unreadCount } = useNotificationBadge();
  const dialog = useDialog();
  const { isPremium } = useSubscription();
  // 수익화(구독)는 해외판 전용 → 국내 메뉴엔 배너 노출 안 함.
  const showSubscriptionBanner = isOverseasLocale();

  // 광고 동의(UMP) 재설정 진입점.
  // EEA/UK 등에서는 "동의 선택을 언제든 바꿀 수 있는 경로"를 제공하는 것이 구글 요구사항이다.
  // 필요 여부는 앱 시작 시 동의 수집 결과로 정해지므로, 화면에 들어올 때마다 다시 읽는다.
  const [showAdPrivacy, setShowAdPrivacy] = React.useState(false);
  useFocusEffect(
    React.useCallback(() => {
      setShowAdPrivacy(isPrivacyOptionsRequired());
    }, []),
  );

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
      ? t('menu.profileRoleCaregiver')
      : user?.diagnosis_year
        ? t('menu.profileDiagnosisYear', { year: user.diagnosis_year })
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
              // 환자 알림 설정은 연동 그룹(=환자 연동)이 있는 보호자에게만.
              .filter((i) => i.key !== 'PatientNotifSettings' || !!user?.patient_group_id)
              .map((i) =>
                i.key === 'Settings'
                  ? {
                      ...i,
                      label: 'menu.settingsCaregiverLabel',
                      desc: 'menu.settingsCaregiverDesc',
                    }
                  : i.key === 'AlarmSoundSettings'
                  ? { ...i, label: 'menu.alarmSoundCaregiverLabel' }
                  : i,
              ),
          }))
        : MENU_SECTIONS.map((section) => ({
            ...section,
            // 환자 알림 설정은 보호자 전용 → 환자 본인 메뉴에선 제거.
            items: section.items.filter((i) => i.key !== 'PatientNotifSettings'),
          }));
    // 해외 로케일 전용 메뉴 숨김:
    // - BlockedUsers: 정보/나눔(커뮤니티) 기능 전용, 해외엔 커뮤니티 탭 자체가 없음.
    // - MyMeds/DoseSlots: 바텀탭 "Reminders"(OverseasMedTabScreen)로 이전됨 —
    //   여기 남겨두면 같은 기능이 두 군데(More 메뉴 + Reminders 탭)에 중복 노출된다.
    const OVERSEAS_HIDDEN_KEYS = ['BlockedUsers', 'MyMeds', 'DoseSlots'];
    // 광고 동의 재설정은 구글이 요구하는 지역에서만 노출(그 외엔 항목 자체가 없다).
    const base2 = showAdPrivacy
      ? base.map((section) =>
          section.title === 'menu.sectionEtc'
            ? {
                ...section,
                items: [
                  ...section.items,
                  {
                    key: 'AdPrivacy',
                    icon: 'options-outline' as const,
                    label: 'menu.adPrivacyLabel',
                    desc: 'menu.adPrivacyDesc',
                  },
                ],
              }
            : section,
        )
      : base;
    const withBlockedUsersGate = isOverseasLocale()
      ? base2.map((section) => ({
          ...section,
          items: section.items.filter((i) => !OVERSEAS_HIDDEN_KEYS.includes(i.key)),
        }))
      : base2;
    // 컨디션 측정 기능 숨김 시 측정 관련 메뉴 항목(환자/보호자) 모두 비노출.
    if (!MEASUREMENT_FEATURE_ENABLED) return withBlockedUsersGate;
    const isPatient = user?.role === 'patient';
    const isCaregiverWithData = user?.role === 'caregiver' && hasPatientMeasurement;
    if (!isPatient && !isCaregiverWithData) return withBlockedUsersGate;
    // 보호자 항목 라벨/설명 — 환자 이름+님 사용. 이름 로드 전이면 잠시 '환자' fallback.
    const pName = patientName ?? t('menu.patientDefaultName');
    const caregiverItem: MenuItem = {
      key: CAREGIVER_MEASUREMENT_VIEW_KEY,
      icon: 'hand-left-outline',
      label: 'menu.measurementCaregiverLabel',
      labelParams: { name: pName },
      desc: 'menu.measurementCaregiverDesc',
      descParams: { name: pName },
    };
    return withBlockedUsersGate.map((section) => {
      if (section.title !== 'menu.sectionRecords') return section;
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
    // showAdPrivacy 는 앱 시작 시 동의 수집이 끝난 뒤에야 true 가 되므로 의존성에 포함해야
    // 메뉴가 다시 만들어진다(빠뜨리면 항목이 영영 안 뜬다).
  }, [user?.role, hasPatientMeasurement, patientName, t, showAdPrivacy]);

  // ⚠️ navigate 가 아니라 push 를 쓴다.
  //   navigate 는 그 화면이 이미 스택에 있으면 아무 일도 하지 않는다. 그래서 메뉴에서
  //   같은 항목을 다시 누르면 "눌러도 반응 없음"이 된다(실측: 약관 → 내 정보 → 개인정보).
  //   메뉴는 누를 때마다 그 화면이 열리는 게 맞으므로 항상 새로 쌓는다.
  const handleMenuPress = async (key: string) => {
    // 약관·개인정보처리방침은 게스트도 열람 가능. 그 외 서버 데이터가 필요한 항목은 게스트 차단.
    const guestAllowed = key === 'Terms' || key === 'Privacy' || key === 'Settings';
    if (!guestAllowed && (await ensureNotGuest(user, dialog, { signOut }))) return;

    if (key === 'AdPrivacy') {
      await showAdsPrivacyOptions();
      setShowAdPrivacy(isPrivacyOptionsRequired());
    } else if (key === 'Records') {
      navigation.push('Records');
    } else if (key === 'Diary') {
      // 일기 화면은 RootNavigator 스택에 있음
      navigateTo('Diary');
    } else if (key === 'VideoList') {
      navigation.push('VideoList');
    } else if (key === 'Settings') {
      navigation.push('Settings');
    } else if (key === 'PatientNotifSettings') {
      navigation.push('Settings', { mode: 'patient' });
    } else if (key === 'MyMeds') {
      navigation.push('MedicationManage', { mode: 'meds' });
    } else if (key === 'DoseSlots') {
      navigation.push('MedicationManage', { mode: 'slots' });
    } else if (key === 'FamilyLink') {
      navigation.push('FamilyLink');
    } else if (key === 'Terms') {
      navigation.push('Terms');
    } else if (key === 'Privacy') {
      navigation.push('Privacy');
    } else if (key === 'MedicalRecordList') {
      navigation.push('MedicalRecordList');
    } else if (key === 'BlockedUsers') {
      navigation.push('BlockedUsers');
    } else if (key === 'AlarmSoundSettings') {
      // 알림음 설정 화면 — MenuNavigator(기록·관리 탭) 스택 내 이동 → 탭바 유지
      navigation.push('AlarmSoundSettings');
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
      title: t('menu.logout'),
      message: t('menu.logoutConfirmMsg'),
      confirmText: t('menu.logout'),
      cancelText: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    signOut();
  };

  const handleWithdraw = async () => {
    if (await ensureNotGuest(user, dialog, { signOut })) return;
    const ok = await dialog.confirm({
      title: t('menu.withdrawTitle'),
      message: t('menu.withdrawConfirmMsg'),
      confirmText: t('menu.withdrawConfirmBtn'),
      cancelText: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    // 탈퇴 흐름 표시 — 세션이 잠깐 남은 채 인증흐름이 재실행돼도 온보딩 프로필을 새로 만들지 않게(→ 로그인으로).
    setWithdrawing(true);
    setDeleting(true);
    // ⚠️ 서버 삭제(=되돌릴 수 없는 지점)까지만 try 로 감싼다.
    //    이후 정리(로그아웃)까지 같은 try 에 두면, 계정은 이미 지워졌는데 로그아웃에서
    //    예외가 났을 때 "실패했으니 다시 시도하라"는 안내가 떠서 사용자를 오도한다
    //    (다시 눌러도 세션이 죽어 401 → 또 실패). 삭제 성공 여부와 정리 실패를 분리한다.
    try {
      // 세션 토큰 확보
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('no session');

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
        console.error('[handleWithdraw] edge function error:', res.status, body);
        throw new Error('account deletion failed');
      }
    } catch (e: any) {
      // 여기까지의 실패 = 계정이 아직 살아있음 → 재시도 안내가 맞다.
      setWithdrawing(false); // 실패 시 플래그 원복
      setDeleting(false);
      dialog.alert({ title: t('common.error'), message: t('menu.withdrawErrorMsg') });
      return;
    }

    // 여기부터는 서버에서 계정이 지워진 뒤다 — 무슨 일이 있어도 "완료"로 끝낸다.
    // 로그아웃해 즉시 로그인 화면으로 보낸다(홈에 잔류/온보딩 오탈출 방지).
    //   signOut 이 user=null 로 만들고 withdrawing 플래그도 해제한다.
    setDeleting(false);
    try {
      await signOut();
    } catch (e) {
      console.error('[handleWithdraw] sign-out failed after successful deletion:', e);
    }
    // 로그인 화면 위로 완료 안내(블로킹 X).
    dialog.alert({
      title: t('menu.withdrawDoneTitle'),
      message: t('menu.withdrawDoneMsg'),
    });
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
          <View style={styles.profileAvatar}>
            <Ionicons name="person" size={26} color={Colors.primary} />
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{user?.name ?? t('menu.profileNameFallback')}</Text>
            {profileSub ? <Text style={styles.profileRole}>{profileSub}</Text> : null}
          </View>
          <View style={styles.profileEditRow}>
            <Text style={styles.profileEditText}>{t('menu.profileEdit')}</Text>
            <Ionicons name="chevron-forward" size={18} color={Colors.primary} />
          </View>
        </TouchableOpacity>

        {/* 구독 배너 (해외판 전용, 프로필 카드 바로 아래) */}
        {showSubscriptionBanner && (
          <TouchableOpacity
            style={styles.subCard}
            onPress={() => navigation.navigate('SubscriptionManage')}
            activeOpacity={0.9}
          >
            <View style={styles.subCardHeader}>
              <Ionicons name="star" size={20} color="#fff" />
              <Text style={styles.subCardTitle}>
                {isPremium ? t('subscription.slotPremiumTitle') : t('subscription.slotFreeTitle')}
              </Text>
            </View>

            <Text style={styles.subCardPitch}>
              {isPremium ? t('subscription.slotPitchPremium') : t('subscription.slotPitchFree')}
            </Text>

            <View style={styles.subCtaPill}>
              <Text style={styles.subCtaPillText}>
                {isPremium ? t('subscription.slotCtaPremium') : t('subscription.slotCtaFree')}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
            </View>
          </TouchableOpacity>
        )}

        {/* 광고 (해외+free 전용) — 구독 슬롯 바로 아래·기록 섹션 위. 페이지 진입 즉시 노출되도록. */}
        <AdSlot placement="more" />

        {/* 섹션별 메뉴 */}
        {menuSections.map((section, sIdx) => (
          <View key={section.title}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{t(section.title).toUpperCase()}</Text>
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
                      <Text style={styles.menuLabel}>{t(item.label, item.labelParams)}</Text>
                      <Text style={styles.menuDesc}>
                        {t(item.desc, item.descParams)}
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
          <Text style={styles.sectionHeaderText}>{t('menu.sectionAccount')}</Text>
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
              <Text style={styles.menuLabel}>{t('menu.logout')}</Text>
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
              <Text style={[styles.menuLabel, styles.dangerLabel]}>{t('menu.withdraw')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={Colors.textHint} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      <BrandProgressOverlay
        visible={deleting}
        title={t('menu.withdrawSpinnerTitle')}
        subtitle={t('menu.withdrawSpinnerSubtitle')}
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
    backgroundColor: Colors.white,
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
  profileAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  /* 구독 슬롯 카드 (해외 전용) — 현재 플랜 상태 + 무료→프리미엄 비교 + CTA */
  subCard: {
    backgroundColor: Colors.primary,
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  subCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  subCardTitle: { fontSize: 17, fontWeight: '800', color: '#fff' },
  subCardPitch: { fontSize: 14, color: 'rgba(255,255,255,0.92)', lineHeight: 20, fontWeight: '500' },
  subCtaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 14,
  },
  subCtaPillText: { fontSize: 16, fontWeight: '800', color: Colors.primary },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 2,
  },
  profileRole: {
    fontSize: 16,
    color: Colors.textSub,
    fontWeight: '500',
  },
  profileEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  profileEditText: {
    fontSize: 16,
    color: Colors.primary,
    fontWeight: '600',
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

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StyleSheet,
  Modal,
  FlatList,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ActivityIndicator,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { BrandProgressOverlay } from '../../components/common/BrandProgressOverlay';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { useDialog } from '../../context/DialogContext';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';
import i18n from '../../i18n';
import { useTranslation } from 'react-i18next';
import { buildHealthRecordsExport } from '../../utils/exportHealthRecords';

type Gender = 'male' | 'female';
type Cohabiting = 'together' | 'apart';

const BIRTH_YEARS = Array.from({ length: 60 }, (_, i) => 1930 + i);
const DIAGNOSIS_YEARS = Array.from({ length: 40 }, (_, i) => 1985 + i);
const RELATIONS = ['배우자', '자녀', '형제/자매', '기타'];

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// 서버 무응답 시 await가 매달리지 않도록 모든 네트워크 호출에 타임아웃(기본 15초)을 건다.
const NET_TIMEOUT_MS = 15000;

// Promise에 타임아웃을 거는 헬퍼. supabase.auth.getSession()처럼 AbortController를
// 직접 받지 않는 호출에 사용한다. 타임아웃 시 명확한 에러를 throw한다.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(i18n.t('profileEdit.timeoutMsg', { label }))),
      ms,
    );
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

// supabase-js .update()는 New Architecture에서 hang됨(resolve/reject 안 됨) → fetch API 직접 사용.
// (참조: SettingsScreen.tsx patchUser, utils/notifications.ts)
// prefer='representation'이면 갱신된 행 배열을 응답으로 받아 RLS로 0행 처리됐는지 감지할 수 있다.
// AbortController + 타임아웃으로 서버 무응답 시 무한 대기(무한 스피너) 방지.
async function patchUser(
  userId: string,
  accessToken: string,
  body: Record<string, unknown>,
  prefer: 'minimal' | 'representation' = 'minimal',
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NET_TIMEOUT_MS);
  try {
    return await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Prefer': `return=${prefer}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error(i18n.t('profileEdit.saveTimeoutMsg'));
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function ProfileEditScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { user, refreshUser } = useAuth();
  const { unreadCount } = useNotificationBadge();
  const dialog = useDialog();
  const isPatient = user?.role === 'patient';

  const [name, setName] = useState('');
  const [birthYear, setBirthYear] = useState(1960);
  const [gender, setGender] = useState<Gender>('male');
  const [diagnosisYear, setDiagnosisYear] = useState(2020);
  const [relation, setRelation] = useState('배우자');
  const [relationOther, setRelationOther] = useState('');
  const [cohabiting, setCohabiting] = useState<Cohabiting>('together');

  type ActivePicker = 'myBirth' | 'myDiagnosis' | 'patientBirth' | 'patientDiagnosis' | null;
  const [activePicker, setActivePicker] = useState<ActivePicker>(null);
  const flatListRef = useRef<FlatList>(null);

  const [patientName, setPatientName] = useState('');
  const [patientBirthYear, setPatientBirthYear] = useState(1955);
  const [patientGender, setPatientGender] = useState<Gender>('male');
  const [patientDiagnosisYear, setPatientDiagnosisYear] = useState(2020);

  const [saving, setSaving] = useState(false);
  const [patientId, setPatientId] = useState<string | null>(null);

  // 계정 정보(읽기 전용) — supabase auth 에서 이메일·로그인 방식(provider) 조회. 수정 불가.
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [accountProvider, setAccountProvider] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!alive) return;
      const au = data?.user;
      setAccountEmail(au?.email ?? null);
      // ⚠️ 카카오 로그인은 kakao-auth Edge Function이 "이메일 유저"로 생성한 뒤
      //    magiclink로 세션을 발급한다 → app_metadata.provider / identities 는 'email'이 된다.
      //    실제 로그인 수단은 createUser 시 user_metadata.provider('kakao')에 남기므로 이걸 최우선으로 본다.
      //    (구글/애플 OAuth는 user_metadata.provider 가 없어 app_metadata.provider 로 자연 폴백됨)
      const prov =
        (au?.user_metadata as any)?.provider ??
        (au?.app_metadata as any)?.provider ??
        (au?.identities && au.identities[0]?.provider) ??
        null;
      setAccountProvider(prov);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // provider 코드 → 표시 라벨(표준 명칭). 알 수 없으면 원문 그대로.
  const providerLabel = (p: string | null): string => {
    if (!p) return t('profileEdit.loginMethodUnknown');
    const key = p.toLowerCase();
    if (key === 'kakao') return t('profileEdit.loginKakao');
    if (key === 'google') return t('profileEdit.loginGoogle');
    if (key === 'apple') return t('profileEdit.loginApple');
    return p;
  };
  // provider 아이콘(브랜드 마크 자산 없이 Ionicons 로 통일).
  const providerIcon = (p: string | null): keyof typeof Ionicons.glyphMap => {
    const key = (p || '').toLowerCase();
    if (key === 'apple') return 'logo-apple';
    if (key === 'google') return 'logo-google';
    if (key === 'kakao') return 'chatbubble';
    return 'person-circle-outline';
  };

  // ── 역할(환자/보호자) 변경 ───────────────────────────────────────────────
  // 온보딩 후 잠긴 역할을 바꾼다(실수로 잘못 가입한 경우 탈퇴 없이 구제).
  //  · 보호자→환자: 안전(삭제 없음) — 단, 그룹에 이미 환자 있으면 서버가 차단.
  //  · 환자→보호자: 건강기록이 "완전 삭제"됨 → 내려받기 제안 후 2단계 경고, 둘 다 OK해야 실행.
  const [roleChanging, setRoleChanging] = useState(false);

  const callChangeRole = async (newRole: 'patient' | 'caregiver', confirm: boolean) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('세션 없음');
    const res = await fetch(`${SUPABASE_URL}/functions/v1/change-role`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_role: newRole, confirm }),
    });
    return (await res.json()) as { ok?: boolean; code?: string; message?: string };
  };

  const finishRoleChange = async (r: { ok?: boolean; message?: string }) => {
    if (!r?.ok) {
      await dialog.alert({ title: t('common.notice'), message: r?.message || t('profileEdit.roleChangeFail') });
      return;
    }
    await refreshUser();
    await dialog.alert({ title: t('profileEdit.roleChangedTitle'), message: r.message || '' });
  };

  const handleChangeRole = async () => {
    if (!user || roleChanging) return;
    const toCaregiver = user.role === 'patient'; // 환자→보호자(파괴적) vs 보호자→환자(안전)

    // ── 보호자 → 환자 : 단일 확인 ──
    if (!toCaregiver) {
      const ok = await dialog.confirm({
        title: t('profileEdit.roleToPatientTitle'),
        message: t('profileEdit.roleToPatientMsg'),
        confirmText: t('profileEdit.roleChangeDo'),
        cancelText: t('common.cancel'),
      });
      if (!ok) return;
      setRoleChanging(true);
      try { await finishRoleChange(await callChangeRole('patient', true)); }
      catch { await dialog.alert({ title: t('common.error'), message: t('profileEdit.roleChangeFail') }); }
      finally { setRoleChanging(false); }
      return;
    }

    // ── 환자 → 보호자 : 내려받기 제안 → 1차 경고 → 2차 경고 ──
    const wantExport = await dialog.confirm({
      title: t('profileEdit.roleExportTitle'),
      message: t('profileEdit.roleExportMsg'),
      confirmText: t('profileEdit.roleExportDownload'),
      cancelText: t('profileEdit.roleExportSkip'),
    });
    if (wantExport) {
      try {
        const { text } = await buildHealthRecordsExport(user.id);
        // 마크다운(제목+표) 텍스트를 공유 시트로 본인에게 전송(카카오톡/메일/메모 등).
        // 폴더 선택·저장권한이 필요없어 60대도 쉽게 보관.
        await Share.share({ message: text });
      } catch {
        // 내보내기 실패해도 삭제 흐름은 계속 진행(경고는 아래에서). 조용히 무시.
      }
    }

    const ok1 = await dialog.confirm({
      title: t('profileEdit.roleWarn1Title'),
      message: t('profileEdit.roleWarn1Msg'),
      confirmText: t('common.continue'),
      cancelText: t('common.cancel'),
      destructive: true, // 파괴적(기록 삭제) 경고 → 확인 버튼 빨강
    });
    if (!ok1) return;

    const ok2 = await dialog.confirm({
      title: t('profileEdit.roleWarn2Title'),
      message: t('profileEdit.roleWarn2Msg'),
      confirmText: t('profileEdit.roleWarn2Confirm'),
      cancelText: t('common.cancel'),
      destructive: true, // 최종 삭제 확인 → 확인 버튼 빨강
    });
    if (!ok2) return;

    setRoleChanging(true);
    try { await finishRoleChange(await callChangeRole('caregiver', true)); }
    catch { await dialog.alert({ title: t('common.error'), message: t('profileEdit.roleChangeFail') }); }
    finally { setRoleChanging(false); }
  };

  // 초기 데이터 로딩 상태 — 폼이 기본값(1960/남자 등)으로 깜빡인 뒤 채워지는 것처럼 보이는 체감 지연을
  // 막기 위해 내 정보가 도착하기 전까지 스피너를 보여준다. (UX 개선 전용, 저장 로직과 무관)
  const [loading, setLoading] = useState(true);
  // 보호자 화면의 '담당 환자 정보' 카드만 별도 로딩 — 내 정보는 먼저 보여주고(부분 렌더)
  // 워터폴로 뒤따라오는 환자 정보는 카드 안에서 따로 스피너를 돌린다.
  const [patientLoading, setPatientLoading] = useState(false);
  // useFocusEffect + useEffect가 진입 시 동시에 loadFormData를 호출해 같은 로드를 2번 네트워크
  // 태우는 것을 막는 동시-중복 호출 가드.
  const loadingGuardRef = useRef(false);

  // 환자 기본정보 원본값(로드 시점) — 저장 시 dirty 비교용.
  // 보호자가 자기 정보만 바꾼 경우 환자 PATCH(RLS상 항상 0행 → throw)를 아예 건너뛰기 위함.
  type PatientSnapshot = {
    name: string;
    birthYear: number;
    gender: Gender;
    diagnosisYear: number;
  };
  const patientOriginalRef = useRef<PatientSnapshot | null>(null);

  // 스피너(BrandProgressOverlay·Modal)가 "완전히 사라진 뒤" 단독으로 띄울 알림을 담아둔다.
  // setSaving(false) → 오버레이가 내려가고 onHidden 콜백이 불릴 때 여기 담긴 알림을 표시한다.
  // 이렇게 하면 닫히는 스피너 Modal 위에 AppDialog Modal을 올리는 적층(=무한 스피너/알림 미표시)이
  // 구조적으로 불가능해진다. afterClose가 있으면 알림 확인 후 실행한다(예: goBack).
  const pendingAlertRef = useRef<{ title: string; message: string; afterClose?: () => void } | null>(null);

  // 저장 버튼이 안드 3버튼/홈 인디케이터에 가리지 않도록 (글로벌 규칙)
  const bottomPad = useBottomSheetPadding(40);
  // 하단 입력 필드(환자 이름 등) 포커스 시 키보드 위로 끌어올리기 위한 ScrollView ref
  const scrollViewRef = useRef<ScrollView>(null);
  // 안드로이드 edge-to-edge(Expo SDK 54+)에서는 키보드가 inset으로 들어와 하단 필드가 가려질 수 있다
  // → 키보드 높이만큼 하단 스페이서를 주고 포커스 필드를 키보드 위로 올린다. (iOS는 automaticallyAdjustKeyboardInsets 처리)
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKbHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKbHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);


  const relEngToKor: Record<string, string> = {
    spouse: '배우자', child: '자녀', sibling: '형제/자매', other: '기타',
  };
  const relKorToEng: Record<string, string> = {
    '배우자': 'spouse', '자녀': 'child', '형제/자매': 'sibling', '기타': 'other',
  };
  const relLabel = (r: string): string => {
    const eng = relKorToEng[r];
    if (eng === 'spouse') return t('profileEdit.relSpouse');
    if (eng === 'child') return t('profileEdit.relChild');
    if (eng === 'sibling') return t('profileEdit.relSibling');
    return t('profileEdit.relOther');
  };

  // 화면 진입 시마다 DB에서 직접 최신 데이터를 불러와 폼 초기화
  // useEffect([user]) 대신 useFocusEffect를 사용해
  // 저장 후 refreshUser()가 user를 갱신해도 폼이 리셋되지 않도록 함
  const loadedRef = useRef(false);

  const loadFormData = useCallback(async () => {
    if (!user) return;
    // 동시 중복 호출 방지 (useFocusEffect + useEffect 동시 발화) — 같은 로드를 두 번 네트워크 태우지 않음
    if (loadingGuardRef.current) return;
    loadingGuardRef.current = true;

    const isCaregiver = user.role === 'caregiver';
    setLoading(true);
    if (isCaregiver) setPatientLoading(true);

    // 재로드 시 이전 환자 스냅샷이 남아 잘못된 dirty 판정을 하지 않도록 초기화
    patientOriginalRef.current = null;

    try {
      // 화면에 필요한 컬럼만 select (select('*') 대비 페이로드/파싱 비용 축소)
      const { data: freshUser, error } = await supabase
        .from('users')
        .select('id, name, birth_year, gender, diagnosis_year, caregiver_relation, relation_note, residence_type, patient_group_id')
        .eq('id', user.id)
        .single();

      if (error || !freshUser) {
        // DB 조회 실패 시 AuthContext user 값으로 폴백
        setName(user.name ?? '');
        setBirthYear(user.birth_year ?? 1960);
        setGender((user.gender as Gender) ?? 'male');
        setDiagnosisYear(user.diagnosis_year ?? 2020);
        setRelation(relEngToKor[user.caregiver_relation ?? ''] ?? '배우자');
        setCohabiting(user.residence_type === 'separate' ? 'apart' : 'together');
      } else {
        setName(freshUser.name ?? '');
        setBirthYear(freshUser.birth_year ?? 1960);
        setGender((freshUser.gender as Gender) ?? 'male');
        setDiagnosisYear(freshUser.diagnosis_year ?? 2020);
        setRelation(relEngToKor[freshUser.caregiver_relation ?? ''] ?? '배우자');
        setRelationOther((freshUser as any).relation_note ?? '');
        setCohabiting(freshUser.residence_type === 'separate' ? 'apart' : 'together');
      }

      // 내 정보가 준비됐으니 폼을 먼저 노출(부분 렌더). 환자 정보는 아래에서 별도 스피너로 처리.
      setLoading(false);

      if (isCaregiver) {
        // patient_group_id 우선, 없으면 patient_group_members 직접 쿼리
        const groupId = freshUser?.patient_group_id ?? user.patient_group_id ?? null;
        let resolvedGroupId: string | null = groupId;

        if (!resolvedGroupId) {
          const { data: myMember } = await supabase
            .from('patient_group_members')
            .select('group_id')
            .eq('user_id', user.id)
            .maybeSingle();
          resolvedGroupId = myMember?.group_id ?? null;
        }

        if (resolvedGroupId) {
          const { data: patientMember } = await supabase
            .from('patient_group_members')
            .select('user_id')
            .eq('group_id', resolvedGroupId)
            .eq('role', 'patient')
            .single();

          if (patientMember?.user_id && patientMember.user_id !== user.id) {
            const { data: patient } = await supabase
              .from('users')
              .select('id, name, birth_year, gender, diagnosis_year')
              .eq('id', patientMember.user_id)
              .single();

            if (patient) {
              const pName = patient.name ?? '';
              const pBirth = patient.birth_year ?? 1955;
              const pGender = (patient.gender as Gender) ?? 'male';
              const pDiag = patient.diagnosis_year ?? 2020;
              setPatientId(patient.id);
              setPatientName(pName);
              setPatientBirthYear(pBirth);
              setPatientGender(pGender);
              setPatientDiagnosisYear(pDiag);
              // dirty 비교 기준이 될 원본값 스냅샷 저장 (저장 시 dirty 비교 보존)
              patientOriginalRef.current = {
                name: pName,
                birthYear: pBirth,
                gender: pGender,
                diagnosisYear: pDiag,
              };
            }
          }
        }
      }
    } finally {
      setLoading(false);
      setPatientLoading(false);
      loadingGuardRef.current = false;
    }
  }, [user]);

  // 화면에 포커스될 때마다 최신 데이터로 폼 초기화
  useFocusEffect(
    useCallback(() => {
      loadedRef.current = false;
      loadFormData();
      return () => {
        loadedRef.current = false;
      };
    }, [loadFormData])
  );

  // user가 null에서 실제 값으로 바뀌는 최초 로드 시에만 초기화 (useFocusEffect 보완)
  useEffect(() => {
    if (user && !loadedRef.current) {
      loadedRef.current = true;
      loadFormData();
    }
  }, [user, loadFormData]);

  const activePickerYears =
    activePicker === 'myBirth' || activePicker === 'patientBirth' ? BIRTH_YEARS : DIAGNOSIS_YEARS;

  const activePickerValue =
    activePicker === 'myBirth' ? birthYear
    : activePicker === 'myDiagnosis' ? diagnosisYear
    : activePicker === 'patientBirth' ? patientBirthYear
    : patientDiagnosisYear;

  const setActivePickerValue = (y: number) => {
    if (activePicker === 'myBirth') setBirthYear(y);
    else if (activePicker === 'myDiagnosis') setDiagnosisYear(y);
    else if (activePicker === 'patientBirth') setPatientBirthYear(y);
    else if (activePicker === 'patientDiagnosis') setPatientDiagnosisYear(y);
  };

  const activePickerTitle =
    activePicker === 'myBirth' ? t('profileEdit.birthYearLabel')
    : activePicker === 'myDiagnosis' ? t('profileEdit.diagnosisYearLabel')
    : activePicker === 'patientBirth' ? t('profileEdit.patientBirthYearLabel')
    : t('profileEdit.patientDiagnosisYearLabel');

  const handleSave = async () => {
    if (!name.trim()) {
      dialog.alert({ title: t('profileEdit.nameCheckTitle'), message: t('profileEdit.nameRequiredMsg') });
      return;
    }
    if (!user) return;

    // ⚠️ 무한 스피너(프리징) 방지 — 두 개의 Modal을 절대 적층하지 않는다.
    // BrandProgressOverlay(Modal)와 AppDialog(Modal)가 동시에 뜨거나, 닫히는 중인
    // 스피너 Modal 위에 AppDialog를 present하면 iOS에서 알림이 안 뜨고 await가 영영 멈춘다.
    // 해결: 알림이 필요한 분기는 pendingAlertRef에 담아두기만 하고 setSaving(false)만 호출 →
    // 스피너 Modal이 "완전히 사라진 뒤"(BrandProgressOverlay onHidden) 단독으로 AppDialog를 띄운다.
    // 성공 경로는 차단 모달을 아예 쓰지 않고 비차단 CenterToast(=Modal 아님)로 피드백한다.
    const queueAlertThenLeave = (opts: { title: string; message: string }) => {
      pendingAlertRef.current = { ...opts, afterClose: () => navigation.goBack() };
      setSaving(false); // → onHidden에서 알림 표시 → 확인 시 goBack
    };

    setSaving(true);
    try {
      // 세션 토큰 확보 (direct-fetch PATCH 인증용) — 무응답 대비 타임아웃
      const { data: { session } } = await withTimeout(
        supabase.auth.getSession(),
        NET_TIMEOUT_MS,
        t('profileEdit.sessionCheckLabel'),
      );
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error(t('profileEdit.sessionExpiredMsg'));

      // 내 정보 저장 (본인 행 → users UPDATE RLS 통과)
      const res = await patchUser(user.id, accessToken, {
        name: name.trim(),
        birth_year: birthYear,
        gender: gender,
        ...(isPatient
          ? { diagnosis_year: diagnosisYear }
          : {
              caregiver_relation: (relKorToEng[relation] ?? 'other') as 'spouse' | 'child' | 'sibling' | 'other',
              residence_type: cohabiting === 'together' ? 'together' : 'separate',
              relation_note: relation === '기타' ? relationOther.trim() : null,
            }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(t('profileEdit.saveFailMsg', { status: res.status, detail: txt ? `: ${txt}` : '' }));
      }

      // 보호자 + 환자 연동된 경우: 환자 기본정보가 "실제로 변경됐을 때만" PATCH 시도.
      // (변경 없는데 PATCH하면 RLS상 항상 0행 → 과거 전체 저장 실패로 회귀했던 버그)
      let patientPartialFail = false;
      if (!isPatient && patientId) {
        const orig = patientOriginalRef.current;
        const patientDirty =
          !orig ||
          orig.name !== patientName.trim() ||
          orig.birthYear !== patientBirthYear ||
          orig.gender !== patientGender ||
          orig.diagnosisYear !== patientDiagnosisYear;

        if (patientDirty) {
          // ⚠️ 환자 행은 users UPDATE RLS(본인 행만 허용)에 막혀 0행 갱신될 수 있다.
          // return=representation으로 갱신 행 수를 확인 → 0행이거나 HTTP 실패면 "부분 실패(비치명적)"로 처리.
          // 본인 정보는 이미 저장됐으므로 전체를 throw로 실패시키지 않는다.
          const patientRes = await patchUser(
            patientId,
            accessToken,
            {
              name: patientName.trim(),
              birth_year: patientBirthYear,
              gender: patientGender,
              diagnosis_year: patientDiagnosisYear,
            },
            'representation',
          );
          if (!patientRes.ok) {
            patientPartialFail = true;
          } else {
            const updatedRows = await patientRes.json().catch(() => []);
            if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
              patientPartialFail = true;
            }
          }
        }
        // patientDirty가 false면 환자 PATCH 분기를 통째로 건너뜀 (보호자가 자기 정보만 바꾼 흔한 경우)
      }

      // 데이터 갱신은 스피너가 떠 있는 동안 마친다(차단 모달 없음).
      await refreshUser();

      // 보호자인데 연동된 환자가 없으면 본인 정보는 저장됐음을 알리고 환자 미연동 안내.
      // (정보성 안내 → 스피너가 완전히 사라진 뒤 단독 AppDialog, 확인 시 goBack)
      if (!isPatient && !patientId) {
        queueAlertThenLeave({
          title: t('profileEdit.savedNoPatientTitle'),
          message: t('profileEdit.savedNoPatientMsg'),
        });
        return;
      }

      // 환자 정보 PATCH가 RLS 등으로 막힌 경우: 본인 정보 저장은 성공으로 처리하고 안내만 별도 표시
      if (patientPartialFail) {
        queueAlertThenLeave({
          title: t('profileEdit.savedPartialTitle'),
          message: t('profileEdit.savedPartialMsg'),
        });
        return;
      }

      // 정상 저장 — 차단 모달 없이 비차단 토스트(CenterToast, Modal 아님)로 피드백 후 즉시 복귀.
      // 토스트는 앱 루트(DialogProvider)에 떠서 화면을 떠나도 유지되며, 스피너 Modal과 절대 겹치지 않는다.
      dialog.alert({ message: t('profileEdit.savedToast'), toast: true });
      setSaving(false);
      navigation.goBack();
    } catch (e: any) {
      // 오류 알림: pendingAlertRef에 담아 setSaving(false)만 호출 → 스피너가 완전히
      // 사라진 뒤 onHidden에서 단독 AppDialog로 표시한다(적층 hang 불가). 화면은 유지(재시도 가능).
      pendingAlertRef.current = {
        title: t('profileEdit.errorTitle'),
        message: e.message ?? t('profileEdit.saveGenericFailMsg'),
      };
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar
        title={t('profileEdit.headerTitle')}
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
      />

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>{i18n.t('loading.loadingGeneric')}</Text>
        </View>
      ) : (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
        keyboardShouldPersistTaps="handled"
        // iOS는 키보드 높이만큼 자동으로 하단 인셋을 잡아 입력칸이 가려지지 않게 함 (RN 0.70+)
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {/* Section 0: 계정 정보 (읽기 전용 — 로그인 이메일·방식) */}
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Ionicons name="shield-checkmark-outline" size={22} color={Colors.primary} />
            <Text style={styles.sectionTitle}>{t('profileEdit.accountTitle')}</Text>
          </View>

          {/* 로그인 방식 */}
          <Text style={styles.label}>{t('profileEdit.loginMethodLabel')}</Text>
          <View style={styles.readonlyRow}>
            <Ionicons
              name={providerIcon(accountProvider)}
              size={20}
              color={Colors.textHint}
              style={{ marginRight: 8 }}
            />
            <Text style={styles.readonlyValue}>{providerLabel(accountProvider)}</Text>
          </View>

          {/* 이메일 */}
          <Text style={[styles.label, { marginTop: 20 }]}>{t('profileEdit.emailLabel')}</Text>
          <View style={styles.readonlyRow}>
            <Text style={styles.readonlyValue}>
              {accountEmail || t('profileEdit.emailNone')}
            </Text>
          </View>

          <Text style={styles.readonlyNote}>{t('profileEdit.accountReadonlyNote')}</Text>
        </View>

        {/* Section 0.5: 역할(환자/보호자) 변경 */}
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Ionicons name="swap-horizontal-outline" size={22} color={Colors.primary} />
            <Text style={styles.sectionTitle}>{t('profileEdit.roleTitle')}</Text>
          </View>

          <Text style={styles.label}>{t('profileEdit.roleCurrentLabel')}</Text>
          <View style={styles.readonlyRow}>
            <Ionicons
              name={isPatient ? 'person-outline' : 'people-outline'}
              size={20}
              color={Colors.textHint}
              style={{ marginRight: 8 }}
            />
            <Text style={styles.readonlyValue}>
              {isPatient ? t('profileEdit.rolePatient') : t('profileEdit.roleCaregiver')}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.roleChangeBtn}
            onPress={handleChangeRole}
            disabled={roleChanging}
            activeOpacity={0.7}
          >
            {roleChanging ? (
              <ActivityIndicator color={Colors.primary} />
            ) : (
              <>
                <Ionicons name="swap-horizontal" size={20} color={Colors.primary} style={{ marginRight: 6 }} />
                <Text style={styles.roleChangeBtnText}>
                  {isPatient ? t('profileEdit.roleChangeToCaregiver') : t('profileEdit.roleChangeToPatient')}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.readonlyNote}>{t('profileEdit.roleNote')}</Text>
        </View>

        {/* Section 1: 내 정보 */}
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Ionicons name="person-outline" size={22} color={Colors.primary} />
            <Text style={styles.sectionTitle}>{t('profileEdit.myInfoTitle')}</Text>
          </View>

          {/* 이름 */}
          <Text style={styles.label}>{t('profileEdit.nameLabel')}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={t('profileEdit.namePlaceholder')}
            placeholderTextColor={Colors.textHint}
            returnKeyType="done"
          />

          {/* 출생연도 */}
          <Text style={[styles.label, { marginTop: 20 }]}>{t('profileEdit.birthYearLabel')}</Text>
          <TouchableOpacity
            style={styles.pickerRow}
            onPress={() => setActivePicker('myBirth')}
            activeOpacity={0.8}
          >
            <Text style={styles.pickerText}>{t('profileEdit.yearSuffix', { y: birthYear })}</Text>
            <Ionicons name="chevron-down" size={22} color={Colors.textSub} />
          </TouchableOpacity>
        </View>

        {/* Section 2: 성별 */}
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Ionicons name="male-female-outline" size={22} color={Colors.primary} />
            <Text style={styles.sectionTitle}>{t('profileEdit.genderTitle')}</Text>
          </View>

          <View style={styles.segRow}>
            <TouchableOpacity
              style={[styles.segBtn, gender === 'male' && styles.segBtnActive]}
              onPress={() => setGender('male')}
              activeOpacity={0.8}
            >
              <Text style={[styles.segBtnText, gender === 'male' && styles.segBtnTextActive]}>
                {t('profileEdit.male')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segBtn, gender === 'female' && styles.segBtnActive]}
              onPress={() => setGender('female')}
              activeOpacity={0.8}
            >
              <Text style={[styles.segBtnText, gender === 'female' && styles.segBtnTextActive]}>
                {t('profileEdit.female')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Section 3: 진단 정보 (환자만) */}
        {isPatient && (
          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <Ionicons name="medical-outline" size={22} color={Colors.primary} />
              <Text style={styles.sectionTitle}>{t('profileEdit.diagnosisInfoTitle')}</Text>
            </View>

            <Text style={styles.label}>{t('profileEdit.diagnosisYearLabel')}</Text>
            <TouchableOpacity
              style={styles.pickerRow}
              onPress={() => setActivePicker('myDiagnosis')}
              activeOpacity={0.8}
            >
              <Text style={styles.pickerText}>{t('profileEdit.yearSuffix', { y: diagnosisYear })}</Text>
              <Ionicons name="chevron-down" size={22} color={Colors.textSub} />
            </TouchableOpacity>
          </View>
        )}

        {/* 보호자 전용: 관계 + 거주 */}
        {!isPatient && (
          <>
            {/* 관계 카드 */}
            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Ionicons name="people-outline" size={22} color={Colors.primary} />
                <Text style={styles.sectionTitle}>{t('profileEdit.relationTitle')}</Text>
              </View>

              <View style={styles.relationGrid}>
                {RELATIONS.map(r => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.relBtn, relation === r && styles.relBtnActive]}
                    onPress={() => setRelation(r)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.relBtnText, relation === r && styles.relBtnTextActive]}>
                      {relLabel(r)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {relation === '기타' && (
                <>
                  <Text style={[styles.label, { marginTop: 16 }]}>{t('profileEdit.relationOtherLabel')}</Text>
                  <TextInput
                    style={styles.input}
                    value={relationOther}
                    onChangeText={setRelationOther}
                    placeholder={t('profileEdit.relationOtherPlaceholder')}
                    placeholderTextColor={Colors.textHint}
                    returnKeyType="done"
                    maxLength={30}
                  />
                </>
              )}
            </View>

            {/* 거주 카드 */}
            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Ionicons name="home-outline" size={22} color={Colors.primary} />
                <Text style={styles.sectionTitle}>{t('profileEdit.residenceTitle')}</Text>
              </View>

              <View style={styles.segRow}>
                <TouchableOpacity
                  style={[styles.segBtn, cohabiting === 'together' && styles.segBtnActive]}
                  onPress={() => setCohabiting('together')}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.segBtnText,
                      cohabiting === 'together' && styles.segBtnTextActive,
                    ]}
                  >
                    {t('profileEdit.together')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.segBtn, cohabiting === 'apart' && styles.segBtnActive]}
                  onPress={() => setCohabiting('apart')}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.segBtnText,
                      cohabiting === 'apart' && styles.segBtnTextActive,
                    ]}
                  >
                    {t('profileEdit.apart')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* 담당 환자 정보 카드 */}
            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Ionicons name="person-outline" size={22} color={Colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>{t('profileEdit.patientInfoTitle')}</Text>
                  <Text style={[styles.label, { marginTop: 2, marginBottom: 0 }]}>
                    {t('profileEdit.patientInfoSub')}
                  </Text>
                </View>
              </View>

              {/* 환자 미연동: 안내 배너 + 가족 연동 버튼만 노출, 환자 입력 필드는 숨김
                  (더미값 1955/남자/2020 노출 방지) */}
              {patientLoading ? (
                <View style={styles.patientLoadingWrap}>
                  <ActivityIndicator color={Colors.primary} />
                  <Text style={styles.patientLoadingText}>{i18n.t('loading.loadingPatientInfo')}</Text>
                </View>
              ) : !patientId ? (
                <>
                  <View style={styles.noPatientBanner}>
                    <Ionicons name="alert-circle-outline" size={20} color="#B45309" />
                    <Text style={styles.noPatientBannerText}>
                      {t('profileEdit.noPatientBanner')}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.linkFamilyBtn}
                    onPress={() => navigation.navigate('FamilyLink')}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="person-add-outline" size={22} color={Colors.white} />
                    <Text style={styles.linkFamilyBtnText}>{t('profileEdit.linkFamilyBtn')}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
              {/* 환자 이름 */}
              <Text style={styles.label}>{t('profileEdit.patientNameLabel')}</Text>
              <TextInput
                style={styles.input}
                value={patientName}
                onChangeText={setPatientName}
                placeholder={t('profileEdit.patientNamePlaceholder')}
                placeholderTextColor={Colors.textHint}
                returnKeyType="done"
                onFocus={() => {
                  // 하단 필드 — 키보드 애니메이션 후 키보드 바로 위로 끌어올림 (특히 안드)
                  setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 250);
                }}
              />

              {/* 환자 출생연도 */}
              <Text style={[styles.label, { marginTop: 20 }]}>{t('profileEdit.patientBirthYearLabel')}</Text>
              <TouchableOpacity
                style={styles.pickerRow}
                onPress={() => setActivePicker('patientBirth')}
                activeOpacity={0.8}
              >
                <Text style={styles.pickerText}>{t('profileEdit.yearSuffix', { y: patientBirthYear })}</Text>
                <Ionicons name="chevron-down" size={22} color={Colors.textSub} />
              </TouchableOpacity>

              {/* 환자 성별 */}
              <Text style={[styles.label, { marginTop: 20 }]}>{t('profileEdit.patientGenderLabel')}</Text>
              <View style={styles.segRow}>
                <TouchableOpacity
                  style={[styles.segBtn, patientGender === 'male' && styles.segBtnActive]}
                  onPress={() => setPatientGender('male')}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.segBtnText, patientGender === 'male' && styles.segBtnTextActive]}>
                    {t('profileEdit.male')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.segBtn, patientGender === 'female' && styles.segBtnActive]}
                  onPress={() => setPatientGender('female')}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.segBtnText, patientGender === 'female' && styles.segBtnTextActive]}>
                    {t('profileEdit.female')}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* 진단 연도 */}
              <Text style={[styles.label, { marginTop: 20 }]}>{t('profileEdit.patientDiagnosisYearLabel')}</Text>
              <TouchableOpacity
                style={styles.pickerRow}
                onPress={() => setActivePicker('patientDiagnosis')}
                activeOpacity={0.8}
              >
                <Text style={styles.pickerText}>{t('profileEdit.yearSuffix', { y: patientDiagnosisYear })}</Text>
                <Ionicons name="chevron-down" size={22} color={Colors.textSub} />
              </TouchableOpacity>
                </>
              )}
            </View>
          </>
        )}

        {/* 공용 연도 선택 Modal */}
        <Modal
          visible={activePicker !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setActivePicker(null)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setActivePicker(null)}
          >
            <View style={styles.modalSheet}>
              <Text style={styles.modalTitle}>{activePickerTitle}</Text>
              <FlatList
                ref={flatListRef}
                data={activePickerYears}
                keyExtractor={y => String(y)}
                initialScrollIndex={Math.max(0, activePickerYears.indexOf(activePickerValue))}
                renderItem={({ item: y }) => (
                  <TouchableOpacity
                    style={[styles.pickerItem, activePickerValue === y && styles.pickerItemActive]}
                    onPress={() => {
                      setActivePickerValue(y);
                      setActivePicker(null);
                    }}
                  >
                    <Text style={[styles.pickerItemText, activePickerValue === y && styles.pickerItemTextActive]}>
                      {t('profileEdit.yearSuffix', { y })}
                    </Text>
                  </TouchableOpacity>
                )}
                onLayout={() => {
                  setTimeout(() => {
                    const idx = activePickerYears.indexOf(activePickerValue);
                    if (idx >= 0) {
                      const viewPos = (activePicker === 'patientBirth' || activePicker === 'patientDiagnosis') ? -0.1 : -0.5;
                      flatListRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: viewPos });
                    }
                  }, 50);
                }}
                getItemLayout={(_, index) => ({ length: 56, offset: 56 * index, index })}
                onScrollToIndexFailed={() => {}}
                scrollEventThrottle={16}
              />
            </View>
          </TouchableOpacity>
        </Modal>

        {/* 저장 버튼 */}
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} disabled={saving}>
          <Text style={styles.saveBtnText}>{t('profileEdit.saveBtn')}</Text>
        </TouchableOpacity>

        {/* 안드: 키보드 높이만큼 하단 스페이서 — 하단 입력 필드 포커스 시 키보드 위로 올림 (iOS는 automaticallyAdjustKeyboardInsets) */}
        {Platform.OS === 'android' && kbHeight > 0 ? <View style={{ height: kbHeight }} /> : null}
      </ScrollView>
      </KeyboardAvoidingView>
      )}
      <BrandProgressOverlay
        visible={saving}
        title={i18n.t('loading.saving')}
        minVisibleMs={500}
        // 스피너 Modal이 완전히 사라진 뒤에만 단독으로 알림을 띄운다(두 Modal 적층 불가 → 멈춤 0).
        onHidden={() => {
          const p = pendingAlertRef.current;
          if (!p) return;
          pendingAlertRef.current = null;
          dialog.alert({ title: p.title, message: p.message }).then(() => p.afterClose?.());
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },

  // 초기 로딩 스피너 (내 정보 도착 전)
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textSub,
  },
  // 담당 환자 정보 카드 내부 로딩 스피너
  patientLoadingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 24,
  },
  patientLoadingText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textSub,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 80,
  },

  // Card
  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },

  // Section header inside card
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.primary,
  },

  // Label
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textSub,
    marginBottom: 8,
  },

  // Text input
  input: {
    height: 60,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 22,
    color: Colors.text,
    backgroundColor: Colors.white,
  },

  // 읽기 전용 값 행(계정 정보) — '내 정보' 입력박스와 동일한 박스 형태(테두리·라운드·높이)에
  //   회색 배경 + 흐린 글자로 "비활성(수정 불가)" 느낌을 준다.
  readonlyRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#F2F2F2',
  },
  readonlyValue: {
    flex: 1,
    fontSize: 20,
    color: Colors.textSub,
    fontWeight: '600',
  },
  readonlyNote: {
    fontSize: 14,
    color: Colors.textSub,
    marginTop: 12,
  },
  roleChangeBtn: {
    marginTop: 14,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.white,
    paddingHorizontal: 16,
  },
  roleChangeBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.primary,
  },

  // Picker row (touchable)
  pickerRow: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    backgroundColor: Colors.white,
  },
  pickerText: { flex: 1, fontSize: 22, color: Colors.text },

  // Modal overlay & sheet
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalSheet: {
    width: '80%',
    maxHeight: 320,
    backgroundColor: Colors.white,
    borderRadius: 16,
    overflow: 'hidden',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textSub,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },

  pickerItem: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  pickerItemActive: { backgroundColor: Colors.light },
  pickerItemText: { fontSize: 20, color: Colors.text },
  pickerItemTextActive: { color: Colors.dark, fontWeight: '700' },

  // Gender / cohabiting segment buttons
  segRow: { flexDirection: 'row', gap: 12 },
  segBtn: {
    flex: 1,
    height: 64,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
  segBtnText: { fontSize: 20, fontWeight: '700', color: Colors.textSub },
  segBtnTextActive: { color: Colors.white },

  // Relation grid
  relationGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  relBtn: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    minWidth: 80,
    alignItems: 'center',
  },
  relBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
  },
  relBtnText: { fontSize: 18, fontWeight: '600', color: Colors.textSub },
  relBtnTextActive: { color: Colors.dark },

  // No patient banner
  noPatientBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  noPatientBannerText: {
    flex: 1,
    fontSize: 16,
    color: '#92400E',
    lineHeight: 22,
  },
  linkFamilyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 56,
    borderRadius: 12,
    backgroundColor: Colors.primary,
  },
  linkFamilyBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.white,
  },

  // Save button
  saveBtn: {
    marginTop: 32,
    height: 64,
    borderRadius: 16,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { fontSize: 22, fontWeight: '700', color: Colors.white },
});

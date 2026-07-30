import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  PanResponder,
  Animated,
  Share,
  Keyboard,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { TopBar } from '../../components/common/TopBar';
import { BrandProgressOverlay } from '../../components/common/BrandProgressOverlay';
import { HangingText } from '../../components/common/HangingText';
import { Colors } from '../../constants/colors';
import { useFamilyLink } from '../../hooks/useFamilyLink';
import { useAuth } from '../../context/AuthContext';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { supabase } from '../../lib/supabase';
import { useDialog } from '../../context/DialogContext';
import { ensureNotGuest } from '../../utils/guestGuard';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';
import { useTranslation } from 'react-i18next';
import { isOverseasLocale } from '../../i18n/detectLocale';

export function FamilyLinkScreen() {
  const { t } = useTranslation();
  // 해외 로케일: 카카오 노란 버튼 대신 중립 스타일(FamilyInviteScreen과 동일 패턴)
  const overseas = isOverseasLocale();
  const RELATION_LABEL: Record<string, string> = {
    spouse: t('familyLink.roleSpouse'),
    child: t('familyLink.roleChild'),
    sibling: t('familyLink.roleSibling'),
    other: t('familyLink.roleOther'),
    parent: t('familyLink.roleParent'),
  };
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  // 바텀시트 하단 패딩 — 안드 3버튼/홈 인디케이터 잘림 방지 (글로벌 규칙, 하드코딩 금지)
  const sheetPaddingBottom = useBottomSheetPadding(36);
  const { user, signOut } = useAuth();
  const { generateInviteCode, joinByCode, joinByCodeForce, getGroupMembers, removeFamilyMember, loading, error: familyLinkError } = useFamilyLink();
  const { unreadCount } = useNotificationBadge();
  const dialog = useDialog();

  const [members, setMembers] = useState<import('../../hooks/useFamilyLink').GroupMember[]>([]);
  const [inviteCode, setInviteCode] = useState('');
  const [loadingCode, setLoadingCode] = useState(false);

  // 중복 실행 방지: loadData가 동시에 2번 호출되는 race condition 차단
  const isLoadingRef = useRef(false);

  // 바텀시트 상태
  const [sheetVisible, setSheetVisible] = useState(false);
  const [inputCode, setInputCode] = useState('');
  const [connecting, setConnecting] = useState(false);

  // 바텀시트 스와이프 애니메이션
  const sheetY = useRef(new Animated.Value(400)).current;

  // iOS 키보드가 올라오면 바텀시트가 키보드 위로 밀려 올라가도록 키보드 높이 추적
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const openSheet = () => {
    setInputCode('');
    setSheetVisible(true);
    Animated.spring(sheetY, {
      toValue: 0,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  };

  const closeSheet = () => {
    Animated.timing(sheetY, {
      toValue: 400,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      setSheetVisible(false);
      setInputCode('');
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => gs.dy > 5,
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) sheetY.setValue(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 80) {
          closeSheet();
        } else {
          Animated.spring(sheetY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const loadData = useCallback(async () => {
    // 이미 실행 중이면 즉시 반환 — race condition 방지
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;

    try {
      const memberList = await getGroupMembers();
      // 방어적 필터: 혹시라도 본인 ID가 포함된 경우 제거 (솔로 그룹 버그 방지)
      setMembers(memberList.filter((m) => m.user_id !== user?.id));

      // 초대 코드는 화면 진입 시 자동 생성하지 않음
      // → 사용자가 "카카오톡으로 초대하기" 또는 공유 버튼을 누를 때만 생성
      // (자동 생성 시 가족 연동 없이도 그룹이 만들어져 본인이 목록에 노출되는 버그 방지)
      if (user?.patient_group_id) {
        // 이미 그룹이 있는 경우: 유효한 초대 코드가 있으면 미리 표시만 해둠 (생성 X)
        const { data: groupRow } = await supabase
          .from('patient_groups')
          .select('invite_code, invite_code_expires_at')
          .eq('id', user.patient_group_id)
          .single();

        const now = new Date().toISOString();
        if (
          groupRow?.invite_code &&
          groupRow.invite_code_expires_at &&
          groupRow.invite_code_expires_at > now
        ) {
          const existingCode = groupRow.invite_code.trim();
          // 6자리 숫자 코드(구버전 8자리도 호환) 모두 표시
          if (existingCode.length >= 6) {
            setInviteCode(existingCode);
          }
        } else {
          setInviteCode('');
        }
      } else {
        // 그룹이 없는 경우: 초대 코드 없음 (버튼 클릭 시 생성)
        setInviteCode('');
      }
    } catch (e: any) {
      console.warn('[FamilyLinkScreen] loadData error:', e);
    } finally {
      isLoadingRef.current = false;
    }
  }, [user, getGroupMembers]);

  // useFocusEffect 하나로 통일 (useEffect + useFocusEffect 동시 호출 race condition 제거)
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleDisconnect = async (member: import('../../hooks/useFamilyLink').GroupMember) => {
    const confirmed = await dialog.confirm({
      title: t('familyLink.disconnectTitle'),
      message: t('familyLink.disconnectMsg', { name: member.user?.name ?? t('familyLink.defaultFamilyName') }),
      confirmText: t('familyLink.disconnect'),
      cancelText: t('familyLink.cancel'),
      destructive: true,
    });
    if (!confirmed) return;
    // 선택한 상대 1명(1개 링크)만 해제 — 다른 가족 연동은 그대로 유지된다.
    const ok = await removeFamilyMember(member.user_id);
    if (ok) {
      // 방어적으로 목록에서 해당 멤버만 제거한 뒤 서버 기준으로 재조회
      setMembers((prev) => prev.filter((m) => m.user_id !== member.user_id));
      isLoadingRef.current = false;
      loadData();
    } else {
      dialog.alert({ title: t('familyLink.errorTitle'), message: t('familyLink.disconnectFailMsg') });
    }
  };

  const handleShareKakao = async () => {
    if (await ensureNotGuest(user, dialog, { signOut })) return;
    let code = inviteCode;
    if (!code) {
      setLoadingCode(true);
      const generated = await generateInviteCode();
      setLoadingCode(false);
      if (!generated) {
        dialog.alert({ title: t('familyLink.errorTitle'), message: t('familyLink.inviteCodeGenFailMsg') });
        return;
      }
      code = generated;
      setInviteCode(code);
    }
    try {
      const message = t('familyLink.shareMessage', { code });
      await Share.share({ message });
    } catch (shareErr) {
      console.warn('[FamilyLinkScreen] share error:', shareErr);
    }
  };

  const handleConnect = async () => {
    if (await ensureNotGuest(user, dialog, { signOut })) return;
    const trimmed = inputCode.trim();
    if (trimmed.length < 6) return;

    setConnecting(true);
    const result = await joinByCode(trimmed);
    setConnecting(false);

    if (result.needsConfirm) {
      // 기존 그룹에 다른 멤버가 있는 경우 → 확인 다이얼로그
      const confirmed = await dialog.confirm({
        title: t('familyLink.familyChangeTitle'),
        message: result.message,
        confirmText: t('familyLink.confirm'),
        cancelText: t('familyLink.cancel'),
        destructive: true,
      });
      if (!confirmed) return;
      setConnecting(true);
      const forceResult = await joinByCodeForce(trimmed);
      setConnecting(false);
      if (forceResult.success) {
        closeSheet();
        await dialog.alert({
          title: t('familyLink.connectDoneTitle'),
          message: forceResult.message,
        });
        isLoadingRef.current = false;
        loadData();
      } else {
        dialog.alert({ title: t('familyLink.connectFailTitle'), message: forceResult.message });
      }
      return;
    }

    if (result.success) {
      closeSheet();
      await dialog.alert({ title: t('familyLink.connectDoneTitle'), message: result.message });
      isLoadingRef.current = false;
      loadData();
    } else {
      dialog.alert({ title: t('familyLink.connectFailTitle'), message: result.message });
    }
  };

  const hasFamilyMembers = members.length > 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar
        title={t('familyLink.headerTitle')}
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── 상태 1: 연동된 가족 없음 ── */}
        {!hasFamilyMembers && (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="people-outline" size={72} color={Colors.textHint} />
            </View>
            <Text style={styles.emptyTitle}>{t('familyLink.noFamilyTitle')}</Text>
            <Text style={styles.emptyDesc}>
              {t('familyLink.noFamilyDesc')}
            </Text>

            <TouchableOpacity
              style={overseas ? styles.primaryBtnNeutral : styles.primaryBtn}
              onPress={handleShareKakao}
              activeOpacity={0.85}
              disabled={loadingCode}
            >
              <View style={styles.btnInner}>
                <Ionicons
                  name={overseas ? 'share-social-outline' : 'chatbubble'}
                  size={24}
                  color={overseas ? Colors.white : '#3C1E1E'}
                />
                <Text style={overseas ? styles.primaryBtnNeutralText : styles.primaryBtnText}>
                  {t('familyLink.inviteBtn')}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.outlineBtn}
              onPress={openSheet}
              activeOpacity={0.85}
            >
              <View style={styles.btnInner}>
                <Ionicons name="keypad-outline" size={24} color={Colors.primary} />
                <Text style={styles.outlineBtnText}>{t('familyLink.enterCodeBtn')}</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 상태 2: 연동된 가족 있음 ── */}
        {hasFamilyMembers && (
          <View>
            <Text style={styles.sectionLabel}>{t('familyLink.linkedFamilySection')}</Text>

            {members.map((member) => {
              const name = member.user?.name ?? t('familyLink.nameless');
              const rawRelation = member.user?.caregiver_relation ?? '';
              // patient_group_members.role 또는 users.role 중 하나가 'patient'이면 환자로 표시
              const memberUserRole = member.user?.role;
              const isPatient = member.role === 'patient' || memberUserRole === 'patient';
              // 역할(환자/보호자)은 필수값이라 항상 표시하고, 관계는 있을 때만 덧붙인다.
              // 예전엔 관계가 있으면 역할 대신 관계를 보여줘서, 같은 보호자인데 한 명은
              // 'Caregiver', 다른 한 명은 'Sibling' 으로 보였다(오너 지적 2026-07-27).
              const role = isPatient
                ? t('familyLink.rolePatient')
                : t('familyLink.roleCaregiverFallback');
              const relation = isPatient
                ? null
                : (RELATION_LABEL[rawRelation] ?? (rawRelation || null));

              // residence_type은 보호자가 설정하는 값이다.
              // - 내가 보호자인 경우: 내 residence_type(user.residence_type)을 사용
              // - 내가 환자인 경우: 상대(보호자)의 residence_type을 사용
              // 보호자 값이 없으면 멤버의 값으로 폴백 (신규 계정/데이터 미설정 대비)
              const isCurrentUserCaregiver = user?.role === 'caregiver';
              const residenceType = isCurrentUserCaregiver
                ? (user?.residence_type ?? member.user?.residence_type)
                : (member.user?.residence_type ?? user?.residence_type);
              // 거주 여부가 저장되지 않은 계정(역할 변경 등으로 비워짐)에는 아무것도 붙이지 않는다.
              // 예전엔 '거주 정보 없음'을 표시했는데, 영어로는 뜻이 통하지 않았고
              // "따로 거주"로 오해되기도 했다(오너 지적 2026-07-27). 모르면 안 쓰는 게 낫다.
              const residence = residenceType === 'together'
                ? t('familyLink.residenceTogether')
                : residenceType === 'separate'
                  ? t('familyLink.residenceSeparate')
                  : null;
              return (
                <View key={member.user_id} style={styles.familyCard}>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>{name}</Text>
                    <Text style={styles.memberSub}>
                      {[role, relation, residence].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.disconnectBtn}
                    onPress={() => handleDisconnect(member)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.disconnectBtnText}>{t('familyLink.disconnectBtn')}</Text>
                  </TouchableOpacity>
                </View>
              );
            })}

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.addFamilyBtn}
                onPress={handleShareKakao}
                activeOpacity={0.85}
                disabled={loadingCode}
              >
                <View style={styles.btnInner}>
                  <Ionicons name="add-circle-outline" size={24} color={Colors.white} />
                  <Text style={styles.addFamilyBtnText}>{t('familyLink.addFamilyBtn')}</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.codeInputBtn}
                onPress={openSheet}
                activeOpacity={0.85}
              >
                <View style={styles.btnInner}>
                  <Ionicons name="keypad-outline" size={24} color={Colors.primary} />
                  <Text style={styles.codeInputBtnText}>{t('familyLink.enterCodeBtn')}</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* 가족 연동 흐름 안내 */}
        <View style={styles.famGuideBox}>
          <HangingText text={t('familyLink.guideTitle')} style={styles.famGuideTitle} />

          <View style={styles.famGuideSection}>
            <Text style={styles.famGuideHead}>{t('familyLink.guideFlowHead')}</Text>
            <Text style={styles.famGuideFlow}>
              {t('familyLink.guideFlowText')}
            </Text>
          </View>

          <View style={styles.famGuideSection}>
            <HangingText text={t('familyLink.guideInviteHead')} style={styles.famGuideHead} />
            <Text style={styles.famGuideFlow}>
              {t('familyLink.guideInviteText')}
            </Text>
          </View>

          <View style={styles.famGuideSection}>
            <HangingText text={t('familyLink.guideReceiveHead')} style={styles.famGuideHead} />
            <Text style={styles.famGuideFlow}>
              {t('familyLink.guideReceiveText')}
            </Text>
            <View style={styles.famGuideNoteRow}>
              <Text style={styles.famGuideNote}>※</Text>
              <Text style={[styles.famGuideNote, styles.famGuideNoteBody]}>
                {t('familyLink.guideReceiveNote')}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* ── 받은 번호 입력 바텀시트 ── */}
      <Modal
        visible={sheetVisible}
        transparent
        animationType="none"
        onRequestClose={closeSheet}
      >
        <TouchableOpacity
          style={styles.sheetDim}
          activeOpacity={1}
          onPress={closeSheet}
        />
        <Animated.View
          style={[
            styles.sheet,
            {
              transform: [{ translateY: sheetY }],
              // 키보드가 올라오면 키보드 높이만큼 바텀시트를 위로 띄워 입력 필드·확인 버튼이 가리지 않게 함
              paddingBottom:
                keyboardHeight > 0
                  ? keyboardHeight + 16
                  : sheetPaddingBottom,
            },
          ]}
        >
          {/* 드래그 핸들 */}
          <View {...panResponder.panHandlers} style={styles.sheetHandle}>
            <View style={styles.handleBar} />
          </View>

          <Text style={styles.sheetTitle}>{t('familyLink.enterCodeSheetTitle')}</Text>
          <Text style={styles.sheetDesc}>
            {t('familyLink.enterCodeSheetDesc')}
          </Text>

          <TextInput
            style={styles.sheetInput}
            value={inputCode}
            onChangeText={text =>
              setInputCode(text.replace(/[^0-9]/g, '').slice(0, 6))
            }
            placeholder={t('familyLink.codePlaceholder')}
            placeholderTextColor={Colors.textHint}
            maxLength={6}
            keyboardType="number-pad"
            autoFocus
          />

          <TouchableOpacity
            style={[
              styles.sheetConnectBtn,
              inputCode.length < 6 && styles.sheetConnectBtnDisabled,
            ]}
            onPress={handleConnect}
            activeOpacity={0.85}
            disabled={inputCode.length < 6 || connecting}
          >
            <Text style={styles.sheetConnectBtnText}>{t('familyLink.connectBtn')}</Text>
          </TouchableOpacity>

          <View style={styles.sheetInfoRow}>
            <Ionicons name="information-circle-outline" size={18} color={Colors.textHint} />
            <Text style={styles.sheetInfoText}>{t('familyLink.installNote')}</Text>
          </View>
        </Animated.View>
      </Modal>
      <BrandProgressOverlay
        visible={loadingCode}
        title={t('familyLink.generatingCodeTitle')}
        minVisibleMs={500}
      />
      <BrandProgressOverlay
        visible={connecting}
        title={t('familyLink.connectingTitle')}
        minVisibleMs={500}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // 가족 연동 흐름 안내 카드
  famGuideBox: {
    backgroundColor: Colors.white, borderRadius: 16, borderWidth: 1, borderColor: Colors.border,
    padding: 18, marginTop: 24, gap: 14,
  },
  famGuideTitle: { fontSize: 17, fontWeight: '700', color: Colors.text, marginBottom: 2 },
  famGuideSection: { gap: 4 },
  famGuideHead: { fontSize: 15, fontWeight: '800', color: Colors.text },
  famGuideFlow: { fontSize: 15, lineHeight: 24, color: Colors.textSub },
  famGuideNote: { fontSize: 15, lineHeight: 24, color: Colors.textSub },
  // "※" 기호와 본문을 별도 Text로 분리한 행(hanging indent) — 본문이 줄바꿈돼도
  // 둘째 줄이 기호 밑(0열)이 아니라 첫 줄 본문 시작 위치에 맞춰지게 한다.
  famGuideNoteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginTop: 6 },
  famGuideNoteBody: { flex: 1 },
  safeArea: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  scroll: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 60,
  },

  // ── 빈 상태 ──
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 48,
    // paddingHorizontal 제거 — 이게 있으면 안의 초대/코드입력 버튼(width:100%)이 아래 설명 박스
    //   (famGuideBox, scrollContent 직속)보다 좌우 8px씩 좁아져 폭이 안 맞았다. scrollContent(padding 20)
    //   기준으로 버튼과 설명 박스가 같은 폭이 되도록 여기선 가로 여백을 두지 않는다.
  },
  emptyIconWrap: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 10,
  },
  emptyDesc: {
    fontSize: 18,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 28,
    marginBottom: 40,
  },

  // ── 공통 버튼 ──
  btnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  primaryBtn: {
    width: '100%',
    minHeight: 60,
    backgroundColor: '#FEE500',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  primaryBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#3C1E1E',
  },
  // 해외용 중립 버튼 (카카오 노란 스타일 대체)
  primaryBtnNeutral: {
    width: '100%',
    minHeight: 60,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  primaryBtnNeutralText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.white,
  },
  outlineBtn: {
    width: '100%',
    minHeight: 60,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.primary,
  },

  // ── 가족 카드 ──
  sectionLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textSub,
    marginBottom: 12,
    marginLeft: 4,
  },
  familyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    padding: 16,
    marginBottom: 12,
  },
  memberInfo: {
    flex: 1,
    marginRight: 14,
  },
  memberName: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  memberSub: {
    fontSize: 16,
    color: Colors.textSub,
  },
  disconnectBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.danger,
  },
  disconnectBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.danger,
  },

  // ── 가족 있을 때 액션 버튼 ──
  actionRow: {
    marginTop: 8,
    gap: 14,
  },
  addFamilyBtn: {
    minHeight: 60,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  addFamilyBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.white,
  },
  codeInputBtn: {
    minHeight: 60,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeInputBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.primary,
  },

  // ── 바텀시트 ──
  sheetDim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    // paddingBottom 은 인라인에서 useBottomSheetPadding(36) 값으로 적용 (하드코딩 금지)
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  sheetHandle: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  handleBar: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.border,
  },
  sheetTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  sheetDesc: {
    fontSize: 16,
    color: Colors.textSub,
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 24,
    lineHeight: 24,
  },
  sheetInput: {
    marginHorizontal: 24,
    minHeight: 68,
    paddingVertical: 12,
    borderWidth: 2,
    borderColor: Colors.border,
    borderRadius: 14,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 8,
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
    color: Colors.text,
    marginBottom: 16,
  },
  sheetConnectBtn: {
    marginHorizontal: 24,
    minHeight: 60,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetConnectBtnDisabled: {
    backgroundColor: Colors.border,
  },
  sheetConnectBtnText: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.white,
  },
  sheetInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    marginTop: 16,
    paddingHorizontal: 24,
  },
  sheetInfoText: {
    fontSize: 16,
    color: Colors.textHint,
  },
});

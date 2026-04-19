import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  PanResponder,
  Animated,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { TopBar } from '../../components/common/TopBar';
import { Colors } from '../../constants/colors';
import { useFamilyLink } from '../../hooks/useFamilyLink';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

const RELATION_MAP: Record<string, string> = {
  spouse: '배우자',
  child: '자녀',
  sibling: '형제/자매',
  other: '기타',
  parent: '부모',
};

export function FamilyLinkScreen() {
  const { user } = useAuth();
  const { generateInviteCode, joinByCode, joinByCodeForce, getGroupMembers, leaveGroup, loading, error: familyLinkError } = useFamilyLink();

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
          if (existingCode.length === 6) {
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
      console.warn('[FamilyLinkScreen] loadData 오류:', e);
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

  const handleDisconnect = (member: import('../../hooks/useFamilyLink').GroupMember) => {
    Alert.alert(
      '연결 해제',
      `${member.user?.name ?? '가족'}님과의 연결을 해제하시겠어요?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '해제',
          style: 'destructive',
          onPress: async () => {
            const ok = await leaveGroup();
            if (ok) {
              setMembers([]);
              setInviteCode('');
              loadData();
            } else {
              Alert.alert('오류', '연결 해제 중 문제가 생겼어요.');
            }
          },
        },
      ],
    );
  };

  const handleShareKakao = async () => {
    let code = inviteCode;
    if (!code) {
      setLoadingCode(true);
      const generated = await generateInviteCode();
      setLoadingCode(false);
      if (!generated) {
        Alert.alert('오류', '초대 코드 생성에 실패했어요. 잠시 후 다시 시도해주세요.');
        return;
      }
      code = generated;
      setInviteCode(code);
    }
    try {
      const message = `파킨온 앱에서 가족 연동을 요청했어요.\n연결 번호: ${code}\n앱이 있다면 '받은 번호 입력'에 입력해주세요.`;
      await Share.share({ message });
    } catch (shareErr) {
      console.warn('[FamilyLinkScreen] 공유 오류:', shareErr);
    }
  };

  const handleConnect = async () => {
    const trimmed = inputCode.trim();
    if (trimmed.length < 6) return;

    setConnecting(true);
    const result = await joinByCode(trimmed);
    setConnecting(false);

    if (result.needsConfirm) {
      // 기존 그룹에 다른 멤버가 있는 경우 → 확인 Alert
      Alert.alert(
        '가족 연동 변경',
        result.message,
        [
          { text: '취소', style: 'cancel' },
          {
            text: '확인',
            style: 'destructive',
            onPress: async () => {
              setConnecting(true);
              const forceResult = await joinByCodeForce(trimmed);
              setConnecting(false);
              Alert.alert(forceResult.success ? '연결 완료' : '연결 실패', forceResult.message);
              if (forceResult.success) {
                closeSheet();
                loadData();
              }
            },
          },
        ]
      );
      return;
    }

    Alert.alert(result.success ? '연결 완료' : '연결 실패', result.message);
    if (result.success) {
      closeSheet();
      loadData();
    }
  };

  const hasFamilyMembers = members.length > 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar title="가족 연동" showBack />

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
            <Text style={styles.emptyTitle}>아직 연동된 가족이 없어요</Text>
            <Text style={styles.emptyDesc}>
              {'카카오톡으로 초대하거나\n받은 번호를 입력해보세요'}
            </Text>

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleShareKakao}
              activeOpacity={0.85}
              disabled={loadingCode}
            >
              {loadingCode ? (
                <ActivityIndicator color="#3C1E1E" size="small" />
              ) : (
                <View style={styles.btnInner}>
                  <Ionicons name="chatbubble" size={24} color="#3C1E1E" />
                  <Text style={styles.primaryBtnText}>카카오톡으로 초대하기</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.outlineBtn}
              onPress={openSheet}
              activeOpacity={0.85}
            >
              <View style={styles.btnInner}>
                <Ionicons name="keypad-outline" size={24} color={Colors.primary} />
                <Text style={styles.outlineBtnText}>받은 번호 입력하기</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 상태 2: 연동된 가족 있음 ── */}
        {hasFamilyMembers && (
          <View>
            <Text style={styles.sectionLabel}>연동된 가족</Text>

            {members.map((member) => {
              const name = member.user?.name ?? '이름 없음';
              const rawRelation = member.user?.caregiver_relation ?? '';
              const role =
                member.role === 'patient' || member.user?.role === 'patient'
                  ? '환자'
                  : (RELATION_MAP[rawRelation] ?? (rawRelation || '보호자'));

              // residence_type은 보호자가 설정하는 값이다.
              // - 내가 보호자인 경우: 내 residence_type(user.residence_type)을 사용
              // - 내가 환자인 경우: 상대(보호자)의 residence_type을 사용
              const isCurrentUserCaregiver = user?.role === 'caregiver';
              const residenceType = isCurrentUserCaregiver
                ? user?.residence_type
                : member.user?.residence_type;
              const residence = residenceType === 'together' ? '함께 거주' : '따로 거주';
              const initials = name.slice(-1);

              return (
                <View key={member.user_id} style={styles.familyCard}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials}</Text>
                  </View>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>{name}</Text>
                    <Text style={styles.memberSub}>
                      {role} · {residence}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.disconnectBtn}
                    onPress={() => handleDisconnect(member)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.disconnectBtnText}>연결 해제</Text>
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
                {loadingCode ? (
                  <ActivityIndicator color={Colors.white} size="small" />
                ) : (
                  <View style={styles.btnInner}>
                    <Ionicons name="add-circle-outline" size={24} color={Colors.white} />
                    <Text style={styles.addFamilyBtnText}>가족 추가하기</Text>
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.codeInputBtn}
                onPress={openSheet}
                activeOpacity={0.85}
              >
                <View style={styles.btnInner}>
                  <Ionicons name="keypad-outline" size={24} color={Colors.primary} />
                  <Text style={styles.codeInputBtnText}>받은 번호 입력하기</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        )}
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
          style={[styles.sheet, { transform: [{ translateY: sheetY }] }]}
        >
          {/* 드래그 핸들 */}
          <View {...panResponder.panHandlers} style={styles.sheetHandle}>
            <View style={styles.handleBar} />
          </View>

          <Text style={styles.sheetTitle}>받은 번호 입력</Text>
          <Text style={styles.sheetDesc}>
            가족에게 받은 6자리 연결 번호를 입력해주세요
          </Text>

          <TextInput
            style={styles.sheetInput}
            value={inputCode}
            onChangeText={text =>
              setInputCode(text.replace(/[^0-9]/g, '').slice(0, 6))
            }
            placeholder="6자리 숫자"
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
            {connecting ? (
              <ActivityIndicator color={Colors.white} size="small" />
            ) : (
              <Text style={styles.sheetConnectBtnText}>연결하기</Text>
            )}
          </TouchableOpacity>

          <View style={styles.sheetInfoRow}>
            <Ionicons name="information-circle-outline" size={18} color={Colors.textHint} />
            <Text style={styles.sheetInfoText}>가족도 파킨온 앱을 설치해야 해요</Text>
          </View>
        </Animated.View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
    paddingHorizontal: 8,
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
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.dark,
  },
  memberInfo: {
    flex: 1,
    marginHorizontal: 14,
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
    paddingBottom: 36,
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
    height: 68,
    borderWidth: 2,
    borderColor: Colors.border,
    borderRadius: 14,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 8,
    textAlign: 'center',
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

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { TopBar } from '../../components/common/TopBar';
import { Colors } from '../../constants/colors';
import { useFamilyLink } from '../../hooks/useFamilyLink';
import { useAuth } from '../../context/AuthContext';

export function FamilyLinkScreen() {
  const { user } = useAuth();
  const { generateInviteCode, joinByCode, getGroupMembers, leaveGroup, loading } = useFamilyLink();

  const [members, setMembers] = useState<import('../../hooks/useFamilyLink').GroupMember[]>([]);
  const [inviteCode, setInviteCode] = useState('');
  const [loadingCode, setLoadingCode] = useState(false);
  const [inputCode, setInputCode] = useState('');
  const [inputFocused, setInputFocused] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    // 그룹 멤버 로드
    const memberList = await getGroupMembers();
    setMembers(memberList);

    // 초대 코드 생성/갱신
    setLoadingCode(true);
    const code = await generateInviteCode();
    if (code) setInviteCode(code);
    setLoadingCode(false);
  };

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

  const handleShareKakao = () => {
    Alert.alert('카카오톡 공유', `연결 번호 ${inviteCode}를 카카오톡으로 공유합니다.`);
  };

  const handleConnect = async () => {
    const trimmed = inputCode.trim().toUpperCase();
    if (trimmed.length < 6) {
      Alert.alert('입력 오류', '6자리 코드를 입력해주세요.');
      return;
    }
    const result = await joinByCode(trimmed);
    Alert.alert(result.success ? '연결 완료' : '연결 실패', result.message);
    if (result.success) {
      setInputCode('');
      loadData();
    }
  };

  const formattedCode = inviteCode.length === 6
    ? `${inviteCode.slice(0, 3)}  ${inviteCode.slice(3)}`
    : '- - - - - -';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar title="가족 연동" showBack />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Section 1: 연결된 가족 ── */}
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Ionicons name="people" size={24} color={Colors.primary} />
            <Text style={styles.sectionTitle}>연결된 가족</Text>
          </View>

          {members.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={52} color={Colors.textHint} />
              <Text style={styles.emptyTitle}>아직 연결된 가족이 없어요</Text>
              <Text style={styles.emptyDesc}>
                {'아래에서 코드를 공유하거나\n입력해보세요'}
              </Text>
            </View>
          ) : (
            members.map((member, index) => (
              <View
                key={member.user_id}
                style={[
                  styles.memberRow,
                  index !== 0 && styles.memberRowBorder,
                ]}
              >
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberAvatarEmoji}>👤</Text>
                </View>
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>{member.user?.name ?? '이름 없음'}</Text>
                  <Text style={styles.memberSub}>
                    {member.role === 'patient' ? '환자' : (member.user?.caregiver_relation ?? '보호자')}
                    {member.user?.residence_type === 'together' ? ' · 함께 거주' : ' · 따로 거주'}
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
            ))
          )}
        </View>

        {/* ── Section 2: 가족 연결 번호 ── */}
        <View style={[styles.card, styles.cardMarginTop]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="key-outline" size={24} color={Colors.primary} />
            <View style={styles.sectionTitleGroup}>
              <Text style={styles.sectionTitle}>가족 연결 번호</Text>
              <Text style={styles.sectionDesc}>24시간 동안 유효해요</Text>
            </View>
          </View>

          <View style={styles.codeBlock}>
            {loadingCode ? (
              <ActivityIndicator size="large" color={Colors.primary} />
            ) : (
              <Text style={styles.codeText}>{formattedCode}</Text>
            )}
            <Text style={styles.codeSubText}>이 번호는 내 가족만 사용할 수 있어요</Text>
          </View>

          <TouchableOpacity
            style={styles.kakaoBtn}
            onPress={handleShareKakao}
            activeOpacity={0.85}
          >
            <Text style={styles.kakaoBtnText}>💬 카카오톡으로 공유하기</Text>
          </TouchableOpacity>
        </View>

        {/* ── OR divider ── */}
        <View style={styles.orDivider}>
          <View style={styles.orLine} />
          <View style={styles.orBadge}>
            <Text style={styles.orText}>또는</Text>
          </View>
          <View style={styles.orLine} />
        </View>

        {/* ── Section 3: 가족이 보내준 번호 입력 ── */}
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Ionicons name="link-outline" size={24} color={Colors.primary} />
            <Text style={styles.sectionTitle}>가족이 보내준 번호 입력</Text>
          </View>

          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={18} color="#F57F17" />
            <Text style={styles.infoBoxText}>
              가족의 파킨온 앱에서 번호를 확인한 후 여기에 입력하세요
            </Text>
          </View>

          <Text style={styles.connectDesc}>
            가족의 6자리 번호를 입력해주세요
          </Text>

          <TextInput
            style={[
              styles.codeInput,
              inputFocused && styles.codeInputFocused,
            ]}
            value={inputCode}
            onChangeText={text => setInputCode(text.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6))}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder="6자리 코드"
            placeholderTextColor={Colors.textHint}
            maxLength={6}
            autoCapitalize="characters"
            keyboardType="default"
          />

          <TouchableOpacity
            style={[
              styles.connectBtn,
              inputCode.length < 6 && styles.connectBtnDisabled,
            ]}
            onPress={handleConnect}
            activeOpacity={0.85}
            disabled={inputCode.length < 6}
          >
            <Text style={styles.connectBtnText}>연결하기</Text>
          </TouchableOpacity>

          <View style={styles.infoRow}>
            <Ionicons
              name="information-circle-outline"
              size={18}
              color={Colors.textHint}
            />
            <Text style={styles.infoText}>가족도 파킨온 앱을 설치해야 해요</Text>
          </View>
        </View>
      </ScrollView>
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

  // ── Card ──
  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    overflow: 'hidden',
  },
  cardMarginTop: {
    marginTop: 16,
  },

  // ── Section header ──
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    gap: 10,
  },
  sectionTitleGroup: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  sectionDesc: {
    fontSize: 15,
    color: Colors.textSub,
    marginTop: 2,
  },

  // ── Empty state ──
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontSize: 18,
    color: Colors.textSub,
    marginTop: 12,
    fontWeight: '600',
  },
  emptyDesc: {
    fontSize: 16,
    color: Colors.textHint,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 24,
  },

  // ── Family member row ──
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  memberRowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  memberAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarEmoji: {
    fontSize: 26,
  },
  memberInfo: {
    flex: 1,
    marginHorizontal: 14,
  },
  memberName: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  memberSub: {
    fontSize: 16,
    color: Colors.textSub,
    marginTop: 3,
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

  // ── Invite code block ──
  codeBlock: {
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: Colors.background,
    borderRadius: 16,
    paddingVertical: 20,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  codeText: {
    fontSize: 36,
    fontWeight: '800',
    color: Colors.dark,
    letterSpacing: 8,
  },
  codeSubText: {
    fontSize: 15,
    color: Colors.textSub,
    marginTop: 10,
  },

  // ── Kakao button ──
  kakaoBtn: {
    margin: 20,
    marginTop: 16,
    backgroundColor: '#FEE500',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kakaoBtnText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#3C1E1E',
  },

  // ── OR divider ──
  orDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },
  orBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  orText: {
    fontSize: 16,
    color: Colors.textSub,
  },

  // ── Info box (section 3) ──
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF8E1',
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
    marginHorizontal: 20,
    marginBottom: 4,
  },
  infoBoxText: {
    flex: 1,
    fontSize: 15,
    color: '#795548',
  },

  // ── Connect section ──
  connectDesc: {
    fontSize: 16,
    color: Colors.textSub,
    marginTop: 8,
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  codeInput: {
    marginHorizontal: 20,
    height: 64,
    borderWidth: 2,
    borderColor: Colors.border,
    borderRadius: 14,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 6,
    textAlign: 'center',
    color: Colors.text,
  },
  codeInputFocused: {
    borderColor: Colors.primary,
  },
  connectBtn: {
    marginHorizontal: 20,
    marginTop: 12,
    height: 64,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectBtnDisabled: {
    backgroundColor: Colors.border,
  },
  connectBtnText: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.white,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 20,
  },
  infoText: {
    fontSize: 16,
    color: Colors.textHint,
  },
});

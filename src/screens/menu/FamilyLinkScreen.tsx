import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';

interface FamilyMember {
  id: string;
  name: string;
  relation: string;
  cohabiting: boolean;
}

const DUMMY_FAMILY: FamilyMember[] = [
  { id: '1', name: '김보호', relation: '배우자', cohabiting: true },
];

const INVITE_CODE = 'AB1234';

export function FamilyLinkScreen() {
  const [family, setFamily] = useState<FamilyMember[]>(DUMMY_FAMILY);
  const [inputCode, setInputCode] = useState('');

  const handleDisconnect = (member: FamilyMember) => {
    Alert.alert(
      '연결 해제',
      `${member.name}님과의 연결을 해제할까요?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '해제',
          style: 'destructive',
          onPress: () => setFamily(prev => prev.filter(m => m.id !== member.id)),
        },
      ],
    );
  };

  const handleShareKakao = () => {
    Alert.alert('카카오톡 공유', '카카오톡 공유 기능은 준비 중이에요.');
  };

  const handleConnect = () => {
    if (inputCode.trim().length < 6) {
      Alert.alert('코드 확인', '6자리 코드를 입력해주세요.');
      return;
    }
    Alert.alert('가족 연결', `코드 "${inputCode}"로 연결 기능은 준비 중이에요.`);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <TopBar title="가족 연동" showBack />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* 연결된 가족 */}
        <Text style={styles.sectionTitle}>연결된 가족</Text>

        {family.length === 0 && (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>연결된 가족이 없어요.</Text>
            <Text style={styles.emptySubText}>아래에서 코드를 공유하거나 입력해보세요.</Text>
          </View>
        )}

        {family.map(member => (
          <View key={member.id} style={styles.familyCard}>
            <View style={styles.familyAvatarBox}>
              <Text style={styles.familyAvatar}>👤</Text>
            </View>
            <View style={styles.familyInfo}>
              <Text style={styles.familyName}>{member.name} / {member.relation}</Text>
              <Text style={styles.familyStatus}>
                {member.cohabiting ? '함께 거주중' : '따로 거주중'}
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
        ))}

        {/* 나의 초대 코드 */}
        <Text style={styles.sectionTitle}>나의 초대 코드</Text>
        <View style={styles.codeCard}>
          <View style={styles.codeBox}>
            {INVITE_CODE.split('').map((char, i) => (
              <View key={i} style={styles.codeChar}>
                <Text style={styles.codeCharText}>{char}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.codeNote}>24시간 동안 유효해요</Text>
          <TouchableOpacity
            style={styles.kakaoBtn}
            onPress={handleShareKakao}
            activeOpacity={0.8}
          >
            <Text style={styles.kakaoBtnText}>💬 카카오톡으로 공유하기</Text>
          </TouchableOpacity>
        </View>

        {/* 코드로 연결하기 */}
        <Text style={styles.sectionTitle}>코드로 가족 연결하기</Text>
        <View style={styles.connectCard}>
          <TextInput
            style={styles.codeInput}
            placeholder="코드 6자리 입력"
            placeholderTextColor={Colors.textHint}
            value={inputCode}
            onChangeText={v => setInputCode(v.toUpperCase().slice(0, 6))}
            maxLength={6}
            autoCapitalize="characters"
          />
          <TouchableOpacity
            style={[
              styles.connectBtn,
              inputCode.trim().length < 6 && styles.connectBtnDisabled,
            ]}
            onPress={handleConnect}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.connectBtnText,
                inputCode.trim().length < 6 && styles.connectBtnTextDisabled,
              ]}
            >
              연결하기
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },

  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textSub,
    marginBottom: 14,
    marginTop: 8,
  },

  emptyBox: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    marginBottom: 24,
  },
  emptyText: { fontSize: 20, fontWeight: '600', color: Colors.textSub, marginBottom: 8 },
  emptySubText: { fontSize: 17, color: Colors.textHint, textAlign: 'center' },

  familyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  familyAvatarBox: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  familyAvatar: { fontSize: 26 },
  familyInfo: { flex: 1 },
  familyName: { fontSize: 20, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  familyStatus: { fontSize: 17, color: Colors.textSub },

  disconnectBtn: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.danger,
  },
  disconnectBtnText: { fontSize: 18, fontWeight: '600', color: Colors.danger },

  codeCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  codeBox: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  codeChar: {
    width: 50,
    height: 62,
    borderRadius: 10,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  codeCharText: { fontSize: 24, fontWeight: '700', color: Colors.dark },
  codeNote: { fontSize: 16, color: Colors.textHint, marginBottom: 16 },
  kakaoBtn: {
    width: '100%',
    backgroundColor: '#FEE500',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  kakaoBtnText: { fontSize: 20, fontWeight: '700', color: '#3C1E1E' },

  connectCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  codeInput: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 20,
    color: Colors.text,
    fontWeight: '700',
    letterSpacing: 4,
    textAlign: 'center',
  },
  connectBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  connectBtnDisabled: { backgroundColor: Colors.border },
  connectBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },
  connectBtnTextDisabled: { color: Colors.textHint },
});

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { Colors } from '../../constants/colors';
import { PrimaryButton } from '../../components/common/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

type Nav = StackNavigationProp<OnboardingStackParamList, 'RoleSelect'>;
type RoleKey = 'patient' | 'caregiver';

const ROLES = [
  {
    key: 'patient',
    emoji: '🧑',
    label: '파킨슨 진단을 받은 환자예요',
    desc: '직접 약 복용과 몸 상태를\n기록할 수 있어요',
  },
  {
    key: 'caregiver',
    emoji: '👨‍👩‍👧',
    label: '파킨슨 환자 가족이에요',
    desc: '가족의 건강 상태를 함께\n확인하고 도울 수 있어요',
  },
] as const;

export function RoleSelectScreen() {
  const navigation = useNavigation<Nav>();
  const { signOut } = useAuth();
  const [selectedRole, setSelectedRole] = useState<RoleKey | null>(null);
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    if (!selectedRole) return;
    setLoading(true);
    try {
      await AsyncStorage.setItem('onboarding_role', selectedRole);

      // 세션이 있으면 DB에도 role 중간 저장
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (userId) {
        const { error } = await supabase
          .from('users')
          .update({ role: selectedRole })
          .eq('id', userId);
        if (error) {
          console.warn('[RoleSelect] role DB 저장 실패 (계속 진행):', error.message);
        }
      }

      navigation.navigate('FamilyCheck');
    } catch (e: any) {
      Alert.alert('오류', '역할 저장 중 문제가 생겼어요. 다시 시도해주세요.\n' + (e?.message ?? ''));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = async () => {
    await signOut();
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* 상단 뒤로가기 */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.backIcon}>←</Text>
          <Text style={styles.backText}>뒤로</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>나는 누구인가요?</Text>
        <Text style={styles.subtitle}>맞는 역할을 선택해주세요</Text>

        <View style={styles.cardsArea}>
          {ROLES.map((role) => {
            const selected = selectedRole === role.key;
            return (
              <TouchableOpacity
                key={role.key}
                style={[styles.card, selected && styles.cardSelected]}
                onPress={() => setSelectedRole(role.key)}
                activeOpacity={0.85}
              >
                {/* 왼쪽 라디오 */}
                <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                  {selected && <View style={styles.radioInner} />}
                </View>

                {/* 중앙 콘텐츠 */}
                <View style={styles.cardCenter}>
                  <Text style={styles.cardEmoji}>{role.emoji}</Text>
                  <Text style={[styles.cardLabel, selected && styles.cardLabelSelected]}>
                    {role.label}
                  </Text>
                  <Text style={[styles.cardDesc, selected && styles.cardDescSelected]}>
                    {role.desc}
                  </Text>
                </View>

                {/* 우측 여백 (라디오 너비만큼 균형) */}
                <View style={{ width: 24 }} />
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* 하단 버튼 영역 */}
      <View style={styles.bottomArea}>
        <PrimaryButton
          title="다음으로"
          onPress={handleConfirm}
          disabled={!selectedRole}
          loading={loading}
        />
        <TouchableOpacity style={styles.closeBtn} onPress={handleClose} activeOpacity={0.7}>
          <Text style={styles.closeBtnText}>닫기</Text>
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
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    color: Colors.textSub,
    marginBottom: 28,
    textAlign: 'center',
  },
  cardsArea: {
    flex: 1,
    gap: 16,
    paddingBottom: 24,
  },
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderWidth: 2,
    borderColor: Colors.border,
    gap: 8,
  },
  cardCenter: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  cardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
  },
  cardEmoji: {
    fontSize: 52,
  },
  cardLabel: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
    lineHeight: 28,
  },
  cardLabelSelected: {
    color: Colors.dark,
  },
  cardDesc: {
    fontSize: 16,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 24,
  },
  cardDescSelected: {
    color: Colors.dark,
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: Colors.primary,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.primary,
  },
  bottomArea: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 12,
  },
  closeBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  closeBtnText: {
    fontSize: 18,
    color: Colors.textSub,
    fontWeight: '600',
  },
});

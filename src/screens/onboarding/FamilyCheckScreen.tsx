import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
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

type Nav = StackNavigationProp<OnboardingStackParamList, 'FamilyCheck'>;

type ViewMode = 'question' | 'code_input';
type ChoiceKey = 'yes' | 'no' | 'unsure';

export function FamilyCheckScreen() {
  const navigation = useNavigation<Nav>();
  const { signOut } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>('question');
  const [selectedChoice, setSelectedChoice] = useState<ChoiceKey | null>(null);
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  const handleCodeChange = (text: string, index: number) => {
    const newCode = [...code];
    const cleaned = text.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    newCode[index] = cleaned.slice(-1);
    setCode(newCode);
    if (cleaned && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleCodeKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const goToNextScreen = async () => {
    const role = await AsyncStorage.getItem('onboarding_role');
    if (role === 'patient') {
      navigation.navigate('PatientInfo', { step: 1 });
    } else {
      navigation.navigate('CaregiverInfo', { step: 1 });
    }
  };

  const handleCodeConfirm = async () => {
    const fullCode = code.join('');
    if (fullCode.length < 6) {
      Alert.alert('', '초대 코드 6자리를 모두 입력해주세요.');
      return;
    }
    setLoading(true);
    try {
      // Supabase patient_groups 테이블에서 초대 코드 검증
      const now = new Date().toISOString();
      const { data: groups, error } = await supabase
        .from('patient_groups')
        .select('id, invite_code_expires_at')
        .eq('invite_code', fullCode)
        .limit(1);

      if (error) {
        // DB 오류 시 경고 후 계속 진행 (코드만 저장)
        console.warn('[FamilyCheck] 코드 검증 오류 (계속 진행):', error.message);
      } else if (!groups || groups.length === 0) {
        Alert.alert('코드 오류', '올바른 초대 코드가 아니에요. 다시 확인해주세요.');
        setLoading(false);
        return;
      } else {
        const group = groups[0];
        // 만료 여부 확인
        if (group.invite_code_expires_at && group.invite_code_expires_at < now) {
          Alert.alert('코드 만료', '초대 코드가 만료됐어요. 가족에게 새 코드를 요청해주세요.');
          setLoading(false);
          return;
        }
        // 그룹 ID 저장 (온보딩 완료 시 DB 연결에 사용)
        await AsyncStorage.setItem('onboarding_group_id', group.id);
      }

      await AsyncStorage.setItem('onboarding_invite_code', fullCode);
      await goToNextScreen();
    } catch (e: any) {
      Alert.alert('오류', '코드 확인 중 문제가 생겼어요.\n' + (e?.message ?? ''));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = async () => {
    await signOut();
  };

  const handleConfirm = async () => {
    if (!selectedChoice) return;
    if (selectedChoice === 'yes') {
      setViewMode('code_input');
    } else {
      await goToNextScreen();
    }
  };

  // ── 코드 입력 화면 ──────────────────────────────────────────────────────────
  if (viewMode === 'code_input') {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {/* 상단 뒤로가기 */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.backBtn} onPress={() => setViewMode('question')} activeOpacity={0.7}>
              <Text style={styles.backIcon}>←</Text>
              <Text style={styles.backText}>뒤로</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.title}>초대 코드를 입력해주세요</Text>
            <Text style={styles.subtitle}>
              가족에게 받은 초대 코드 6자리를{'\n'}입력해주세요
            </Text>

            <View style={styles.codeRow}>
              {code.map((char, i) => (
                <TextInput
                  key={i}
                  ref={(ref) => { inputRefs.current[i] = ref; }}
                  style={[styles.codeBox, char && styles.codeBoxFilled]}
                  value={char}
                  onChangeText={(text) => handleCodeChange(text, i)}
                  onKeyPress={({ nativeEvent }) => handleCodeKeyPress(nativeEvent.key, i)}
                  maxLength={1}
                  autoCapitalize="characters"
                  keyboardType="default"
                  textAlign="center"
                />
              ))}
            </View>
          </ScrollView>

          {/* 하단 버튼 */}
          <View style={styles.bottomArea}>
            <PrimaryButton
              title="확인하기"
              onPress={handleCodeConfirm}
              loading={loading}
              disabled={code.join('').length < 6}
            />
            <TouchableOpacity style={styles.closeBtn} onPress={handleClose} activeOpacity={0.7}>
              <Text style={styles.closeBtnText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── 질문 화면 ───────────────────────────────────────────────────────────────
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
        <Text style={styles.title}>
          가족 중에 파킨온을{'\n'}쓰고 있는 분이 계신가요?
        </Text>
        <Text style={styles.subtitle}>
          가족과 연결하면 서로 건강 상태를{'\n'}확인할 수 있어요
        </Text>

        <View style={styles.btnGroup}>
          {([
            { key: 'yes', emoji: '✅', label: '네, 있어요', desc: '초대 코드로 연결할게요' },
            { key: 'no', emoji: '🆕', label: '아니요, 저 혼자 처음 시작해요', desc: '나중에 가족을 초대할 수 있어요' },
            { key: 'unsure', emoji: '🤔', label: '잘 모르겠어요', desc: '' },
          ] as { key: ChoiceKey; emoji: string; label: string; desc: string }[]).map((item) => {
            const selected = selectedChoice === item.key;
            return (
              <TouchableOpacity
                key={item.key}
                style={[styles.choiceCard, selected && styles.choiceCardSelected]}
                onPress={() => setSelectedChoice(item.key)}
                activeOpacity={0.85}
              >
                <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                  {selected && <View style={styles.radioInner} />}
                </View>
                <Text style={styles.choiceEmoji}>{item.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>{item.label}</Text>
                  {item.desc ? <Text style={[styles.choiceDesc, selected && styles.choiceDescSelected]}>{item.desc}</Text> : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* 하단 버튼 */}
      <View style={styles.bottomArea}>
        <PrimaryButton
          title="다음으로"
          onPress={handleConfirm}
          disabled={!selectedChoice}
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
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 12,
    lineHeight: 38,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    color: Colors.textSub,
    marginBottom: 28,
    lineHeight: 28,
    textAlign: 'center',
  },
  btnGroup: {
    flex: 1,
    gap: 14,
    paddingBottom: 24,
  },
  choiceCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: Colors.border,
    gap: 16,
  },
  choiceCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
  },
  choiceEmoji: {
    fontSize: 32,
  },
  choiceLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  choiceLabelSelected: {
    color: Colors.dark,
  },
  choiceDesc: {
    fontSize: 14,
    color: Colors.textSub,
  },
  choiceDescSelected: {
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
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginTop: 16,
    marginBottom: 32,
  },
  codeBox: {
    width: 48,
    height: 60,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  codeBoxFilled: {
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
    color: Colors.dark,
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

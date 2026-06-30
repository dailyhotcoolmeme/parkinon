import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { Colors } from '../../constants/colors';
import { PrimaryButton } from '../../components/common/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../context/DialogContext';
import { supabase } from '../../lib/supabase';

type Nav = StackNavigationProp<OnboardingStackParamList, 'FamilyCheck'>;

type ViewMode = 'question' | 'code_input';
type ChoiceKey = 'yes' | 'no' | 'unsure';

export function FamilyCheckScreen() {
  const navigation = useNavigation<Nav>();
  const { signOut } = useAuth();
  const dialog = useDialog();
  const bottomPadding = useBottomSheetPadding(24);
  const [viewMode, setViewMode] = useState<ViewMode>('question');
  const [selectedChoice, setSelectedChoice] = useState<ChoiceKey | null>(null);
  // 초대 코드는 항상 6자리 숫자 (generateInviteCode가 숫자 코드만 생성).
  // 60대+ 타겟 UX: 칸 분리 입력 시 키보드가 칸 이동마다 리셋되는 불편을 없애기 위해
  // 단일 입력 필드 + 숫자 키패드 고정으로 통일.
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCodeChange = (text: string) => {
    setCode(text.replace(/[^0-9]/g, '').slice(0, 6));
  };

  const goToNextScreen = async () => {
    navigation.navigate('RoleSelect');
  };

  const handleCodeConfirm = async () => {
    const fullCode = code;
    if (fullCode.length < 6) {
      dialog.alert({ message: '초대 번호를 모두 입력해주세요.' });
      return;
    }
    setLoading(true);
    try {
      // ⚠️ supabase-js PostgREST 클라이언트(supabase.from().select())는 RN 새 아키텍처에서
      //    응답 없이 hang하거나 오류를 반환하는 버그가 있다(앱 전반에서 raw fetch로 우회 중).
      //    이전 구현은 이 오류를 console.warn으로 삼키고 group_id 없이 코드만 저장한 채 진행 →
      //    온보딩 완료(handleFinish) 시 joinGroupId가 null이라 그룹 합류/멤버 INSERT가 통째로 누락되는
      //    치명적 버그가 있었다. 따라서 (1) 세션 토큰을 붙인 raw fetch로 조회하고,
      //    (2) 그룹이 확정되지 않으면(조회 실패·미존재·만료) 진행을 막는다.
      const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
      const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        // 코드 조회 RLS 정책(초대코드 조회)은 auth.uid() IS NOT NULL을 요구한다.
        // 세션 토큰이 없으면 조회가 비로그인(anon)으로 나가 0행이 되어 오판하므로 명확히 차단한다.
        dialog.alert({ title: '로그인 필요', message: '로그인 정보가 만료됐어요. 앱을 다시 시작한 뒤 시도해주세요.' });
        setLoading(false);
        return;
      }

      // 코드→그룹 조회는 SECURITY DEFINER RPC로 일원화한다.
      //   (광범위 patient_groups SELECT RLS 정책을 보안상 제거했으므로, 비멤버는
      //    직접 SELECT 불가. RPC가 유효+미만료 코드의 그룹 id 만 반환한다.)
      const lookupRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/lookup_group_id_by_invite_code`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ p_code: fullCode }),
      });

      if (!lookupRes.ok) {
        // 조회 자체가 실패하면 group_id를 확정할 수 없으므로 진행 금지(조용히 무시 금지).
        const errText = await lookupRes.text().catch(() => '');
        console.warn('[FamilyCheck] 코드 조회 실패:', lookupRes.status, errText);
        dialog.alert({ title: '확인 실패', message: '초대 코드 확인 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.' });
        setLoading(false);
        return;
      }

      // 스칼라 uuid 반환: JSON 문자열("uuid") 또는 raw 문자열 / null.
      let groupId: string | null = null;
      try {
        const parsed: any = await lookupRes.clone().json();
        if (typeof parsed === 'string') groupId = parsed;
        else if (parsed && typeof parsed === 'object' && typeof parsed.lookup_group_id_by_invite_code === 'string') {
          groupId = parsed.lookup_group_id_by_invite_code;
        }
      } catch {
        const txt = (await lookupRes.text().catch(() => '')).trim();
        groupId = txt && txt !== 'null' ? txt.replace(/^"|"$/g, '') : null;
      }

      if (!groupId) {
        dialog.alert({ title: '코드 오류', message: '올바른 초대 번호가 아니거나 만료됐어요. 다시 확인해주세요.' });
        setLoading(false);
        return;
      }

      const group = { id: groupId };

      // ── 환자명 확인 단계 ──────────────────────────────────────────────────
      // 그룹은 확정됐지만, 다음 화면으로 넘어가기 전에 "어떤 환자와 연동되는지"를
      // 마스킹된 이름으로 보여주고 확인을 받는다(잘못된 코드 입력 방지).
      // DB RPC get_invite_patient_masked_name(p_code)는 authenticated 권한으로 실행 가능.
      const rpcUrl = `${SUPABASE_URL}/rest/v1/rpc/get_invite_patient_masked_name`;
      let maskedName: string | null = null;
      try {
        const rpcRes = await fetch(rpcUrl, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ p_code: fullCode }),
        });
        if (rpcRes.ok) {
          // 단일 스칼라 반환이라 본문이 JSON 문자열("최*철") 또는 raw 문자열일 수 있다.
          let parsed: any = null;
          try {
            parsed = await rpcRes.clone().json();
          } catch {
            parsed = await rpcRes.text().catch(() => null);
          }
          if (typeof parsed === 'string') maskedName = parsed;
          else if (parsed && typeof parsed === 'object' && typeof parsed.name === 'string') maskedName = parsed.name;
        } else {
          console.warn('[FamilyCheck] 환자명 조회 RPC 실패:', rpcRes.status);
        }
      } catch (rpcErr) {
        console.warn('[FamilyCheck] 환자명 조회 RPC 예외:', rpcErr);
      }

      const trimmedName = (maskedName ?? '').trim();
      const hasPatient = !!trimmedName && trimmedName !== 'null';

      // 그룹은 확정됐다. 환자 유무에 따라 확인 문구만 달라진다.
      //  - 환자 있는 그룹: 마스킹된 환자명으로 "○○님과 연동돼요" 확인.
      //  - 환자 없는 보호자 선(先)그룹(결정 A): 아직 환자 없이 가족(보호자)끼리 먼저
      //    연결되는 경우 → 코드 오류로 막지 말고 안내 후 진행. (나중에 환자 후합류 가능)
      //    ※ 환자 2명/환자 이동 위험은 서버 RPC(join_family_by_code) + DB 제약이 막는다.
      setLoading(false);
      const ok = hasPatient
        ? await dialog.confirm({
            title: '연동할 가족 확인',
            message: `${trimmedName} 님과 가족으로 연동돼요.\n맞으신가요?`,
            confirmText: '네, 맞아요',
            cancelText: '아니요, 다시 입력할게요',
          })
        : await dialog.confirm({
            title: '가족 연결 확인',
            message: '아직 환자가 등록되지 않은 가족 그룹이에요.\n가족(보호자)끼리 먼저 연결되고, 환자분은 나중에 함께 연결할 수 있어요.\n이 가족과 연결할까요?',
            confirmText: '네, 연결할게요',
            cancelText: '아니요, 다시 입력할게요',
          });
      if (!ok) {
        // 취소 → 저장하지 않고 코드 입력 화면에 머무름(입력값 비우기)
        setCode('');
        return;
      }

      // 그룹 ID 확정 — 온보딩 완료 시 patient_group_id 세팅 + 멤버 INSERT에 사용
      await AsyncStorage.setItem('onboarding_group_id', group.id);
      await AsyncStorage.setItem('onboarding_invite_code', fullCode);
      await goToNextScreen();
    } catch (e: any) {
      await dialog.alert({ title: '오류', message: '코드 확인 중 문제가 생겼어요.\n' + (e?.message ?? '') });
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
              가족에게 받은 초대 번호를{'\n'}입력해주세요
            </Text>

            <View style={styles.codeRow}>
              <TextInput
                style={[styles.codeInput, code.length > 0 && styles.codeInputFilled]}
                value={code}
                onChangeText={handleCodeChange}
                placeholder="초대 번호 (숫자)"
                placeholderTextColor={Colors.textHint}
                maxLength={6}
                keyboardType="number-pad"
                textAlign="center"
                autoFocus
              />
            </View>
          </ScrollView>

          {/* 하단 버튼 */}
          <View style={[styles.bottomArea, { paddingBottom: bottomPadding }]}>
            <PrimaryButton
              title="확인하기"
              onPress={handleCodeConfirm}
              loading={loading}
              disabled={code.length < 6}
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

      <ScrollView
        contentContainerStyle={styles.contentScroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>
          가족 중에 파킨온을{'\n'}쓰고 있는 분이 계신가요?
        </Text>
        <Text style={styles.subtitle}>
          가족 연결하면 환자분의 기록을{'\n'}실시간으로 확인할 수 있어요
        </Text>

        <View style={styles.btnGroup}>
          {([
            { key: 'yes', label: '네, 있어요', desc: '초대 코드로 연결할게요' },
            { key: 'no', label: '아니요, 저 혼자 처음 시작해요', desc: '나중에 가족을 초대할 수 있어요' },
            { key: 'unsure', label: '잘 모르겠어요', desc: '' },
          ] as { key: ChoiceKey; label: string; desc: string }[]).map((item) => {
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
                <View style={{ flex: 1 }}>
                  <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>{item.label}</Text>
                  {item.desc ? <Text style={[styles.choiceDesc, selected && styles.choiceDescSelected]}>{item.desc}</Text> : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* 하단 버튼 */}
      <View style={[styles.bottomArea, { paddingBottom: bottomPadding }]}>
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
  contentScroll: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 220,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
  },
  title: {
    fontSize: 23,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
    lineHeight: 32,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 17,
    color: Colors.textSub,
    marginBottom: 20,
    lineHeight: 25,
    textAlign: 'center',
  },
  btnGroup: {
    gap: 14,
    paddingBottom: 24,
  },
  choiceCard: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 22,
    borderWidth: 2,
    borderColor: Colors.border,
    gap: 16,
  },
  choiceCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
  },
  choiceLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
    lineHeight: 28,
    includeFontPadding: true,
    textAlignVertical: 'center',
  },
  choiceLabelSelected: {
    color: Colors.dark,
  },
  choiceDesc: {
    fontSize: 14,
    color: Colors.textSub,
    lineHeight: 21,
    includeFontPadding: true,
    textAlignVertical: 'center',
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
  codeInput: {
    width: '100%',
    maxWidth: 320,
    minHeight: 76,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: 10,
    color: Colors.text,
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  codeInputFilled: {
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
    color: Colors.dark,
  },
  bottomArea: {
    paddingHorizontal: 24,
    paddingTop: 16,
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

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { Colors } from '../../constants/colors';
import { PrimaryButton } from '../../components/common/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { requestPermissionsAndSaveToken, scheduleMedicationReminders, scheduleExerciseReminders } from '../../utils/notifications';
import { useSettings } from '../../context/SettingsContext';

type Nav = StackNavigationProp<OnboardingStackParamList, 'NotificationSetup'>;

interface NotifOption {
  key: string;
  label: string;
  desc: string;
  enabled: boolean;
}

export function NotificationSetupScreen() {
  const navigation = useNavigation<Nav>();
  const { signOut, user } = useAuth();
  const { exerciseNotifs } = useSettings();

  const [options, setOptions] = useState<NotifOption[]>([
    {
      key: 'after30',
      label: '복용 30분 후',
      desc: '약이 흡수되는 시간에 컨디션을 확인해요',
      enabled: true,
    },
    {
      key: 'after2h',
      label: '복용 2시간 후',
      desc: '약효가 나타나는 시간에 컨디션을 확인해요',
      enabled: true,
    },
  ]);

  const toggleOption = (key: string) => {
    setOptions((prev) =>
      prev.map((o) => (o.key === key ? { ...o, enabled: !o.enabled } : o))
    );
  };

  const handleConfirm = async () => {
    const settings: Record<string, boolean> = {};
    options.forEach((o) => { settings[o.key] = o.enabled; });
    await AsyncStorage.setItem('onboarding_notifications', JSON.stringify(settings));

    if (user) {
      // accessToken을 직접 전달하여 supabase-js PostgREST hang 버그 우회
      const { data: { session } } = await (await import('../../lib/supabase')).supabase.auth.getSession();
      const accessToken = session?.access_token;

      // 권한 요청 + Android 채널 설정 + push token 저장
      await requestPermissionsAndSaveToken(user.id, accessToken);
      // 약 복용 예정 알림 스케줄
      await scheduleMedicationReminders();
      // 운동 알림 스케줄
      await scheduleExerciseReminders(exerciseNotifs);
    }

    navigation.navigate('FamilyInvite');
  };

  const enabledCount = options.filter((o) => o.enabled).length;

  return (
    <SafeAreaView style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.backIcon}>←</Text>
          <Text style={styles.backText}>뒤로</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroArea}>
          <Text style={styles.title}>알림을{'\n'}설정해드릴게요</Text>
          <Text style={styles.subtitle}>
            💊 약 드실 시간(아침·점심·저녁·취침)에{'\n'}매일 알림이 자동으로 발송돼요.{'\n\n'}
            아래는 복용 후 컨디션 확인 알림이에요.{'\n'}나중에 설정에서 바꾸실 수 있어요.
          </Text>
        </View>

        <View style={styles.optionList}>
          {options.map((opt) => (
            <View key={opt.key} style={[styles.optionCard, opt.enabled && styles.optionCardEnabled]}>
              <View style={styles.optionInfo}>
                <Text style={[styles.optionLabel, opt.enabled && styles.optionLabelEnabled]}>
                  {opt.label}
                </Text>
                <Text style={styles.optionDesc}>{opt.desc}</Text>
              </View>
              <Switch
                value={opt.enabled}
                onValueChange={() => toggleOption(opt.key)}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor={Colors.white}
                ios_backgroundColor={Colors.border}
                style={styles.toggle}
              />
            </View>
          ))}
        </View>

        {enabledCount === 0 && (
          <View style={styles.warningCard}>
            <Text style={styles.warningText}>
              알림을 받으시면 약효 패턴을 더 정확하게 확인할 수 있어요
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.bottomArea}>
        <PrimaryButton
          title={enabledCount > 0 ? `알림 받을게요 (${enabledCount}개)` : '알림 없이 계속할게요'}
          onPress={handleConfirm}
          variant={enabledCount > 0 ? 'primary' : 'outline'}
        />
        <TouchableOpacity style={styles.closeBtn} onPress={signOut}>
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
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  heroArea: {
    alignItems: 'center',
    marginBottom: 36,
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
    lineHeight: 28,
    textAlign: 'center',
  },
  optionList: {
    gap: 12,
    marginBottom: 16,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 20,
    borderWidth: 2,
    borderColor: Colors.border,
    minHeight: 72,
  },
  optionCardEnabled: {
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
  },
  optionInfo: {
    flex: 1,
    gap: 4,
  },
  optionLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textSub,
  },
  optionLabelEnabled: {
    color: Colors.dark,
  },
  optionDesc: {
    fontSize: 14,
    color: Colors.textSub,
  },
  toggle: {
    transform: [{ scaleX: 1.1 }, { scaleY: 1.1 }],
  },
  warningCard: {
    backgroundColor: '#FFF3E0',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: Colors.accent,
  },
  warningText: {
    fontSize: 16,
    color: Colors.text,
    lineHeight: 24,
  },
  bottomArea: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 12,
  },
  closeBtn: {
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 18,
    color: Colors.textSub,
    fontWeight: '600',
  },
});

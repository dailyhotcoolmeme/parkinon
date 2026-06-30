// 플랫폼별 게이트 정책:
// - Android: 하드 블록(알림 허용 전까지 진입 불가). canSkip=false → "나중에" 버튼 없음.
// - iOS: 소프트. App Store 심사 정책상 알림 권한을 앱 이용 필수로 강제할 수 없으므로
//   canSkip=true → "나중에 할게요"(onSkip) 버튼을 노출해 권한 없이도 진입 가능.
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { Colors } from '../../constants/colors';
import { requestPermissionsAndSaveToken } from '../../utils/notifications';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';

interface Props {
  userId: string;
  accessToken?: string;
  canAskAgain: boolean;
  /** iOS 소프트 게이트 여부. true면 "나중에 할게요" 버튼을 노출해 권한 없이도 진입 허용. */
  canSkip?: boolean;
  /** "나중에 할게요" 콜백(iOS 전용). 게이트를 건너뛰고 메인으로 진입한다. */
  onSkip?: () => void;
  onRecheck: () => void;
}

/**
 * 알림 권한 게이트(전체 화면).
 * - Android: 권한 허용 전까지 앱 본화면(MainNavigator) 진입을 막는 하드 블록 UI.
 * - iOS(canSkip): 같은 안내 + "알림 허용하기"는 보여주되 "나중에 할게요"로 진입 가능(소프트).
 * 60대 이상 타겟 가독성 규칙 준수(큰 글씨/큰 버튼/아이콘+텍스트/고대비).
 */
export function NotificationGateScreen({
  userId,
  accessToken,
  canAskAgain,
  canSkip = false,
  onSkip,
  onRecheck,
}: Props) {
  const bottomPadding = useBottomSheetPadding();
  const [busy, setBusy] = useState(false);

  const handleAllow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (canAskAgain) {
        // OS 권한 다이얼로그 표시
        await Notifications.requestPermissionsAsync();
      }
      // 허용된 경우 채널 생성 + push_token 저장 (거부 시 내부적으로 스킵)
      await requestPermissionsAndSaveToken(userId, accessToken);
    } finally {
      setBusy(false);
      onRecheck();
    }
  };

  const handleOpenSettings = () => {
    Linking.openSettings();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <Ionicons name="notifications-outline" size={88} color={Colors.primary} />
        <Text style={styles.title}>알림을 허용해 주세요</Text>
        <Text style={styles.body}>
          파킨온은 약 복용 시간 알림, 약효 추적 알림, 보호자 연동 알림을 위해 알림이 꼭 필요해요.{' '}
          <Text style={styles.bodyEmphasis}>광고나 마케팅 알림은 절대 보내지 않아요.</Text>{' '}
          원활한 사용을 위해 알림을 허용해 주세요.
        </Text>
      </View>

      <View style={[styles.bottom, { paddingBottom: bottomPadding }]}>
        {canAskAgain ? (
          <TouchableOpacity
            style={styles.button}
            onPress={handleAllow}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <>
                <Ionicons name="notifications-outline" size={24} color={Colors.white} />
                <Text style={styles.buttonText}>알림 허용하기</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              style={styles.button}
              onPress={handleOpenSettings}
              activeOpacity={0.85}
            >
              <Ionicons name="settings-outline" size={24} color={Colors.white} />
              <Text style={styles.buttonText}>설정에서 알림 켜기</Text>
            </TouchableOpacity>
            <Text style={styles.helper}>
              설정에서 알림을 켠 뒤 앱으로 돌아오면 자동으로 진행돼요.
            </Text>
          </>
        )}

        {/* iOS 소프트 게이트: 권한 없이도 진입 가능한 중립 톤 버튼(애플 심사 정책 대응). */}
        {canSkip && onSkip && (
          <TouchableOpacity
            style={styles.skipButton}
            onPress={onSkip}
            disabled={busy}
            activeOpacity={0.7}
          >
            <Text style={styles.skipButtonText}>나중에 할게요</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 24,
    marginBottom: 16,
    textAlign: 'center',
  },
  body: {
    fontSize: 19,
    lineHeight: 30,
    color: Colors.text,
    textAlign: 'center',
  },
  bodyEmphasis: {
    fontWeight: '700',
    color: Colors.dark,
  },
  bottom: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  button: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingHorizontal: 20,
  },
  buttonText: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.white,
  },
  helper: {
    fontSize: 16,
    color: Colors.textSub,
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 24,
  },
  // iOS 소프트 게이트 "나중에 할게요" — 중립 톤(테두리 없는 텍스트 버튼), 60대 가독성(56dp/18sp+).
  skipButton: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingHorizontal: 20,
  },
  skipButtonText: {
    fontSize: 19,
    fontWeight: '600',
    color: Colors.textSub,
  },
});

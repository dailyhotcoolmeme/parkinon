import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '../../constants/colors';
import i18n from '../../i18n';

// 마지막으로 잡은 JS 오류를 저장하는 AsyncStorage 키.
// 다음 세션 시작 시(App.tsx) 읽어 console.warn 으로 노출 → 폰 로그/디버그에서 원인 확인 가능.
export const LAST_JS_ERROR_KEY = 'parkinon_last_js_error';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string | null;
}

/**
 * 전역 ErrorBoundary.
 *
 * 목적: 알림 내역 탭 → 약복용/약효추적 화면 진입 시 **렌더 단계**에서 throw 가 나면
 *       (onPress try/catch 로는 못 잡힘) 앱이 그대로 닫혀 버린다.
 *       이 ErrorBoundary 가 그 throw 를 잡아 흰화면/크래시 대신 fallback UI 를 띄우고,
 *       오류 메시지+stack+componentStack 을 AsyncStorage 에 저장한다.
 *
 * 배치: App.tsx 의 RootNavigator 를 감싼다(NavigationContainer 포함 전체).
 *       → 어떤 화면 렌더에서 throw 가 나도 앱이 죽지 않는다.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error?.message ?? i18n.t('errorBoundary.unknownError') };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // 콘솔에도 즉시 출력
    console.error('[ErrorBoundary] 렌더 단계 오류 캡처:', error, info?.componentStack);

    // AsyncStorage 에 오류 상세 저장(타임스탬프 포함) — 다음 세션에서 확인 가능.
    const payload = {
      ts: new Date().toISOString(),
      message: error?.message ?? null,
      stack: error?.stack ?? null,
      componentStack: info?.componentStack ?? null,
    };
    AsyncStorage.setItem(LAST_JS_ERROR_KEY, JSON.stringify(payload)).catch((e) => {
      console.warn('[ErrorBoundary] 오류 저장 실패:', e);
    });
  }

  handleReset = () => {
    // fallback 의 "홈으로" — 상태만 리셋해 children 을 다시 렌더 시도.
    // (네비게이션 상태는 그대로 유지되므로, 직전에 진입하려던 화면이 다시 throw 하면
    //  ErrorBoundary 가 또 잡는다. 무한 크래시 대신 안전하게 fallback 으로 회복.)
    this.setState({ hasError: false, errorMessage: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.emoji}>😣</Text>
            <Text style={styles.title}>{i18n.t('errorBoundary.title')}</Text>
            <Text style={styles.subtitle}>
              {i18n.t('errorBoundary.subtitle')}
            </Text>

            {/* 디버그용 오류 메시지 노출 — 원인 확인을 위해 error.message 표시 */}
            {this.state.errorMessage ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorLabel}>{i18n.t('errorBoundary.errorLabel')}</Text>
                <Text style={styles.errorText}>{this.state.errorMessage}</Text>
              </View>
            ) : null}

            <TouchableOpacity style={styles.button} onPress={this.handleReset} activeOpacity={0.85}>
              <Text style={styles.buttonText}>{i18n.t('errorBoundary.homeBtn')}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 40,
  },
  emoji: {
    fontSize: 56,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 17,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 24,
  },
  errorBox: {
    width: '100%',
    backgroundColor: '#FFF3E0',
    borderRadius: 12,
    padding: 16,
    marginBottom: 28,
  },
  errorLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#E65100',
    marginBottom: 6,
  },
  errorText: {
    fontSize: 15,
    color: '#333333',
    lineHeight: 22,
  },
  button: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    minHeight: 56,
    paddingHorizontal: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.white,
  },
});

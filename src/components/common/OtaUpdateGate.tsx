import * as Updates from 'expo-updates';
import { useUpdates } from 'expo-updates';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  View,
} from 'react-native';

/**
 * OTA 자동 재시작 게이트.
 *
 * - expo-updates가 새 번들을 다운로드 완료하면 (isUpdatePending) 모달 표시
 * - 5초 카운트다운 후 Updates.reloadAsync() 호출하여 앱 재시작
 * - 재시작 실패 시 silent fallback (다음 cold start에 자연 적용)
 *
 * 목적: 알림 탭 시 cold start와 OTA 적용이 충돌해서 알림 응답이
 * 손실되는 race를 차단. 포그라운드에서 미리 OTA를 적용해두면
 * 알림 탭 시점엔 이미 새 번들이라 race가 발생하지 않음.
 */
export function OtaUpdateGate() {
  const { isUpdatePending } = useUpdates();
  const [showModal, setShowModal] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!isUpdatePending) return;
    if (startedRef.current) return; // 중복 호출 방지
    startedRef.current = true;

    setShowModal(true);
    setCountdown(5);

    let n = 5;
    const interval = setInterval(() => {
      n -= 1;
      setCountdown(n);
      if (n <= 0) {
        clearInterval(interval);
        Updates.reloadAsync().catch(() => {
          // 재시작 실패 → 모달 닫고 다음 cold start에 자연 적용
          setShowModal(false);
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isUpdatePending]);

  if (!showModal) return null;

  return (
    <Modal transparent visible={showModal} animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>업데이트가 있어요</Text>
          <Text style={styles.message}>
            최신 버전을 적용하기 위해{'\n'}
            앱이 잠시 다시 시작됩니다.
          </Text>
          <ActivityIndicator
            size="large"
            color="#FF7F00"
            style={{ marginVertical: 24 }}
          />
          <Text style={styles.countdown}>
            {Math.max(countdown, 0)}초 후 자동 재시작
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 32,
    width: '80%',
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
    color: '#222',
  },
  message: {
    fontSize: 18,
    color: '#333',
    textAlign: 'center',
    lineHeight: 26,
  },
  countdown: {
    fontSize: 16,
    color: '#666',
  },
});

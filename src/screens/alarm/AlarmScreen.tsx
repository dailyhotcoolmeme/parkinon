/**
 * AlarmScreen — 전체화면 알람("알람처럼" 방식) 표시 화면.
 *
 * 오너 설계(2026-07-16): 녹색 배경 + 파킨온 아이콘(회전)만. **텍스트 없음.**
 *   이유=프라이버시. 화면에 "파킨온/파킨슨"이 글자로 뜨면 외부인이 볼 때 병을 감추고 싶은
 *   사용자가 거부감을 느낌 → 브랜드/병명 텍스트를 일절 노출하지 않는다(끄기 버튼만).
 *
 * 안드 full-screen intent(notifee)로 앱이 이 화면을 띄운다. 화면이 떠 있는 동안
 *   해당 알림음을 반복 재생하고(끌 때까지), 하단 큰 버튼으로 끈다.
 * ⚠️ 실제 트리거(full-screen intent)·서버 발송 연동은 네이티브/서버 단계에서 배선(재빌드).
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing, TouchableOpacity, StatusBar, BackHandler } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation, type RouteProp } from '@react-navigation/native';
import { Audio } from 'expo-av';
import { Colors } from '../../constants/colors';
import { PRESET_PREVIEW_ASSETS } from '../../constants/presetPreviewAssets';
import type { RootStackParamList } from '../../navigation/RootNavigator';

const SYMBOL = require('../../../assets/parkinon-symbol-en.png');

export function AlarmScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Alarm'>>();
  const navigation = useNavigation<any>();
  const fileId = route.params?.fileId ?? null;

  // 회전 애니메이션(끊김 없이 반복).
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true }),
    );
    anim.start();
    return () => anim.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // 알림음 반복 재생(끌 때까지). fileId 없으면 무음(시각만).
  const soundRef = useRef<Audio.Sound | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const asset = fileId ? PRESET_PREVIEW_ASSETS[fileId] : null;
      if (!asset) return;
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          playThroughEarpieceAndroid: false,
          shouldDuckAndroid: false,
          staysActiveInBackground: true,
        });
        const { sound } = await Audio.Sound.createAsync(asset, { shouldPlay: true, isLooping: true });
        if (!alive) { await sound.unloadAsync().catch(() => {}); return; }
        soundRef.current = sound;
      } catch {
        /* 재생 실패해도 화면은 유지 */
      }
    })();
    return () => {
      alive = false;
      const s = soundRef.current;
      soundRef.current = null;
      if (s) s.unloadAsync().catch(() => {});
    };
  }, [fileId]);

  const dismiss = useCallback(async () => {
    const s = soundRef.current;
    soundRef.current = null;
    if (s) await s.unloadAsync().catch(() => {});
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Main');
  }, [navigation]);

  // 안드 뒤로가기로도 끄기.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { dismiss(); return true; });
    return () => sub.remove();
  }, [dismiss]);

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <Animated.Image source={SYMBOL} style={[styles.icon, { transform: [{ rotate }] }]} resizeMode="contain" />
      {/* 끄기 — 텍스트(브랜드/병명) 없이 큰 아이콘 버튼만 */}
      <TouchableOpacity style={styles.dismissBtn} onPress={dismiss} activeOpacity={0.85}>
        <Ionicons name="power" size={44} color={Colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.primary, // 녹색 배경
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    width: 160,
    height: 160,
    tintColor: Colors.white, // 녹색 위 대비 위해 흰색 실루엣
  },
  dismissBtn: {
    position: 'absolute',
    bottom: 72,
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

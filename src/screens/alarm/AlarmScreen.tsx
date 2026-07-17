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
import { View, Text, StyleSheet, Animated, Easing, TouchableOpacity, StatusBar, BackHandler } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Audio } from 'expo-av';
import { Colors } from '../../constants/colors';
import { PRESET_PREVIEW_ASSETS } from '../../constants/presetPreviewAssets';
import { navigateTo } from '../../navigation/navigationRef';
import type { RootStackParamList } from '../../navigation/RootNavigator';

const SYMBOL = require('../../../assets/parkinon-symbol-en.png');

export function AlarmScreen() {
  const { t } = useTranslation();
  const route = useRoute<RouteProp<RootStackParamList, 'Alarm'>>();
  const fileId = route.params?.fileId ?? null;
  const kind = route.params?.kind ?? 'remind';
  const doseSlotId = route.params?.doseSlotId ?? null;
  const preview = route.params?.preview ?? false; // 미리보기면 실제 기록·알림 없음

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

  const stopSound = useCallback(async () => {
    const s = soundRef.current;
    soundRef.current = null;
    if (s) await s.unloadAsync().catch(() => {});
  }, []);

  // 복용 완료(복약 알람) → 그 슬롯 약을 복용 완료 처리(실제 누른 시각·기존 기록 로직 재사용·멱등).
  //   Medication 탭으로 autoTakeSlotId 전달 → proceedSave 로 med_logs+약효추적+보호자알림+몸상태팝업.
  const handleTaken = useCallback(async () => {
    await stopSound();
    // 미리보기면 기록 안 함(autoTakeSlotId 미전달) → 실제 med_logs·보호자 알림·사전기록 팝업 없음.
    navigateTo('Main', {
      screen: 'Medication',
      params: (!preview && doseSlotId) ? { autoTakeSlotId: doseSlotId } : undefined,
    });
  }, [stopSound, doseSlotId, preview]);

  // 약효추적 알람 → 몸상태 기록 화면으로.
  const handleRecordTrack = useCallback(async () => {
    await stopSound();
    navigateTo('Main', { screen: 'BodyStateTab', params: { screen: 'BodyState' } });
  }, [stopSound]);

  // 나중에 → 기록 없이 닫기(해당 탭으로만 이동).
  const handleLater = useCallback(async () => {
    await stopSound();
    if (kind === 'track') navigateTo('Main', { screen: 'BodyStateTab', params: { screen: 'BodyState' } });
    else navigateTo('Main', { screen: 'Medication' });
  }, [stopSound, kind]);

  // 안드 뒤로가기 = 나중에(기록 없이 닫힘).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { handleLater(); return true; });
    return () => sub.remove();
  }, [handleLater]);

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <Animated.Image source={SYMBOL} style={[styles.icon, { transform: [{ rotate }] }]} resizeMode="contain" />
      {/* 하단 버튼 — 브랜드/병명 텍스트는 없음(기능 라벨만) */}
      <View style={styles.btnGroup}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={kind === 'track' ? handleRecordTrack : handleTaken}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>
            {kind === 'track' ? t('alarmScreen.recordBody') : t('alarmScreen.taken')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.laterBtn} onPress={handleLater} activeOpacity={0.7}>
          <Text style={styles.laterBtnText}>{t('alarmScreen.later')}</Text>
        </TouchableOpacity>
      </View>
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
  btnGroup: {
    position: 'absolute',
    bottom: 64,
    left: 32,
    right: 32,
    alignItems: 'center',
  },
  primaryBtn: {
    width: '100%',
    minHeight: 72,
    borderRadius: 18,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { fontSize: 24, fontWeight: '800', color: Colors.dark },
  laterBtn: { marginTop: 14, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  laterBtnText: { fontSize: 18, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
});

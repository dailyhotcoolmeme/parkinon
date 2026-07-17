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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Audio } from 'expo-av';
import { Colors } from '../../constants/colors';
import { PRESET_PREVIEW_ASSETS } from '../../constants/presetPreviewAssets';
import { navigateTo } from '../../navigation/navigationRef';
import { stopActiveAlarm } from '../../lib/localAlarm';
import type { RootStackParamList } from '../../navigation/RootNavigator';

const SYMBOL = require('../../../assets/parkinon-symbol-en.png');

export function AlarmScreen() {
  const { t } = useTranslation();
  const route = useRoute<RouteProp<RootStackParamList, 'Alarm'>>();
  const fileId = route.params?.fileId ?? null;
  const kind = route.params?.kind ?? 'remind';
  const doseSlotId = route.params?.doseSlotId ?? null;
  const preview = route.params?.preview ?? false; // 미리보기면 실제 기록·알림 없음
  // 약효추적 알람 문맥(kind==='track') — 몸상태 기록을 그 복용에 매칭.
  const minutes = route.params?.minutes ?? null;
  const medLogId = route.params?.medLogId ?? null;
  const mealTime = route.params?.mealTime ?? null;
  // 실제 알람을 띄운 notifee 알림 id(끌 때 소리 반복 중지용).
  const notifId = route.params?.notifId ?? null;

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

  // 알림음 반복 재생 — 미리보기(preview)일 때만 자체 재생.
  //   실제 알람은 notifee 포그라운드 서비스(loopSound)가 소리를 반복하므로 여기서 재생하면 이중.
  const soundRef = useRef<Audio.Sound | null>(null);
  useEffect(() => {
    if (!preview) return; // 실제 알람: notifee 가 소리 담당
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
  }, [fileId, preview]);

  // 소리 중지 — 미리보기는 expo-av 언로드, 실제 알람은 notifee 포그라운드 서비스 중지+알림 제거.
  const stopSound = useCallback(async () => {
    const s = soundRef.current;
    soundRef.current = null;
    if (s) await s.unloadAsync().catch(() => {});
    if (!preview) await stopActiveAlarm(notifId);
  }, [preview, notifId]);

  // 복용 완료(복약 알람) → 그 슬롯 약을 복용 완료 처리(실제 누른 시각·기존 기록 로직 재사용·멱등).
  //   Medication 탭으로 autoTakeSlotId 전달 → proceedSave 로 med_logs+약효추적+보호자알림+몸상태팝업.
  const handleTaken = useCallback(async () => {
    await stopSound();
    // 실제: autoTakeSlotId(기록+알림+다음알림). 미리보기: previewNextNotifSlotId(기록·알림 없이 다음알림만).
    navigateTo('Main', {
      screen: 'Medication',
      params: doseSlotId
        ? (preview ? { previewNextNotifSlotId: doseSlotId } : { autoTakeSlotId: doseSlotId })
        : undefined,
    });
  }, [stopSound, doseSlotId, preview]);

  // 약효추적 알람 → 몸상태 기록 화면으로.
  //   실제: triggerMinutes(복용후 분)·doseSlotId·medLogId·mealTime 을 실어 기존 약효추적 알림 탭과
  //         동일하게 처리(pendingBodyStateNotif + route params) → 약효 패턴(triggered_by='notification') 반영.
  //   미리보기: 문맥 없이 몸상태 탭만(실제 기록 방지).
  const handleRecordTrack = useCallback(async () => {
    await stopSound();
    if (preview) {
      navigateTo('Main', { screen: 'BodyStateTab', params: { screen: 'BodyState' } });
      return;
    }
    const triggerTs = Date.now();
    try {
      await AsyncStorage.multiRemove(['pendingMedNotif', 'pendingExerciseNotif']);
      await AsyncStorage.setItem(
        'pendingBodyStateNotif',
        JSON.stringify({
          triggerMinutes: minutes,
          triggerMealTime: mealTime,
          triggerDoseSlotId: doseSlotId,
          triggerMedLogId: medLogId,
          ts: triggerTs,
        }),
      );
    } catch {
      /* pending 세팅 실패해도 route params 경로로 진행 */
    }
    navigateTo('Main', {
      screen: 'BodyStateTab',
      params: {
        screen: 'BodyState',
        params: {
          triggerMinutes: minutes,
          triggerMealTime: mealTime,
          triggerDoseSlotId: doseSlotId,
          triggerMedLogId: medLogId,
          triggerTs,
        },
      },
    });
  }, [stopSound, preview, minutes, mealTime, doseSlotId, medLogId]);

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
      {/* 미리보기 안내 — 실제 기록·보호자 알림 없음 */}
      {preview && <Text style={styles.previewNote}>{t('alarmScreen.previewNote')}</Text>}
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
  previewNote: {
    marginTop: 28,
    paddingHorizontal: 36,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.92)',
    textAlign: 'center',
  },
  laterBtn: { marginTop: 14, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  laterBtnText: { fontSize: 18, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
});

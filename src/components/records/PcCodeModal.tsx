// PC에서 보기 — 6자리 코드 안내 모달
//
// 사용자가 PC(parkinon.com)에서 입력할 6자리 코드를 크게 보여준다.
// create-web-token 호출은 부모(RecordsScreen)가 담당하고,
// 이 모달은 받은 code/expiresAt 표시 + 카운트다운 + 재발급/복사/닫기만 책임진다.
//
// 60대 가독성(글씨 18sp+, 버튼 56dp+) 준수. 애기말투 금지, 표준·일반어.
// 스와이프 다운 닫기 + 안드 백버튼 + 배경탭 닫기 지원(공용 훅 useSwipeDownDismiss).

import React, { useEffect, useState } from 'react';
import { OverlaySheet } from '../common/OverlaySheet';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
  BackHandler,
  Clipboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useSwipeDownDismiss } from '../../hooks/useSwipeDownDismiss';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { isOverseasLocale } from '../../i18n/detectLocale';


// react-native 코어 Clipboard는 최신 RN에서 제거되어 import가 undefined일 수 있다.
// expo-clipboard는 미설치(네이티브라 OTA로 새로 못 넣음).
// 모듈 로드 시점에 한 번만 가드 — setString이 함수일 때만 사용, 아니면 null.
// clip이 null이면 복사 버튼을 아예 렌더하지 않는다(복사는 보조 기능, 없어도 됨).
const clip =
  Clipboard && typeof (Clipboard as any).setString === 'function' ? Clipboard : null;

export interface PcCodeModalProps {
  visible: boolean;
  /** 발급된 6자리 코드 (없으면 로딩/에러 상태) */
  code: string | null;
  /** 만료 시각(ISO 문자열). 카운트다운 기준 */
  expiresAt: string | null;
  /** create-web-token 호출 중 여부 */
  loading: boolean;
  /** 발급 실패 시 안내 문구 (없으면 null) */
  errorMsg: string | null;
  /** 번호 다시 받기(재발급) */
  onReissue: () => void;
  onClose: () => void;
}

/** 남은 시간(초) → "m분 s초" / "s초" */
function formatRemain(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (isOverseasLocale()) {
    if (sec <= 0) return '0s';
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }
  if (sec <= 0) return i18n.t('dateFmt.secondsLeft', { s: 0 });
  if (m > 0) return i18n.t('dateFmt.minutesSecondsLeft', { m, s });
  return i18n.t('dateFmt.secondsLeft', { s });
}

export function PcCodeModal({
  visible,
  code,
  expiresAt,
  loading,
  errorMsg,
  onReissue,
  onClose,
}: PcCodeModalProps) {
  const { t } = useTranslation();
  const { translateY, panHandlers, resetPosition } = useSwipeDownDismiss(onClose);

  // 남은 시간(초). expiresAt 기반으로 1초마다 갱신
  const [remainSec, setRemainSec] = useState(0);
  const [copied, setCopied] = useState(false);

  // 재오픈 시 카드 위치 초기화
  useEffect(() => {
    if (visible) resetPosition();
  }, [visible]);

  // 안드 백버튼 닫기
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  // 코드가 바뀌면 복사 표시 초기화
  useEffect(() => {
    setCopied(false);
  }, [code]);

  // 카운트다운: expiresAt 기준 매초 갱신
  useEffect(() => {
    if (!visible || !expiresAt) {
      setRemainSec(0);
      return;
    }
    const target = new Date(expiresAt).getTime();
    const tick = () => {
      const diff = Math.round((target - Date.now()) / 1000);
      setRemainSec(diff > 0 ? diff : 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [visible, expiresAt]);

  const expired = !!code && remainSec <= 0;

  const handleCopy = () => {
    if (!code || !clip) return;
    // 가드를 통과해도 호출 자체가 throw할 수 있으니 try/catch로 크래시 차단.
    try {
      clip.setString(code);
      setCopied(true);
    } catch {
      // 복사 실패 — 6자리 코드는 화면에 크게 보이므로 조용히 무시한다.
    }
  };

  // 6자리를 한 줄에 또렷하게 — 자간은 letterSpacing으로 주고, 글자 사이 이중 공백은 제거(폭 넘침 방지)
  const spacedCode = code ?? '';

  return (
    <OverlaySheet visible={visible} onRequestClose={onClose} animationType="fade">
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.centerContainer} pointerEvents="box-none">
        <Animated.View
          style={[styles.card, { transform: [{ translateY }] }]}
          {...panHandlers}
        >
          {/* 스와이프 핸들 */}
          <View style={styles.grabber} />

          {/* 헤더 */}
          <View style={styles.headerWrap}>
            <View style={styles.iconWrap}>
              <Ionicons name="desktop-outline" size={34} color={Colors.primary} />
            </View>
            <Text style={styles.title}>{t('pcCode.title')}</Text>
          </View>

          {/* 로딩 */}
          {loading && (
            <View style={styles.stateBox}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.stateText}>{t('pcCode.generating')}</Text>
            </View>
          )}

          {/* 에러 */}
          {!loading && !!errorMsg && (
            <View style={styles.stateBox}>
              <Ionicons name="alert-circle-outline" size={40} color={Colors.textHint} />
              <Text style={styles.stateText}>{errorMsg}</Text>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={onReissue}
                activeOpacity={0.85}
              >
                <Ionicons name="refresh-outline" size={20} color={Colors.white} />
                <Text style={styles.primaryBtnText}>{t('pcCode.reissueBtn')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 정상 — 코드 표시 */}
          {!loading && !errorMsg && !!code && (
            <>
              <Text style={styles.guideText}>
                {t('pcCode.guidePre')}{'\n'}
                <Text style={styles.guideStrong}>parkinon.com</Text> {t('pcCode.guideMid')}
                {'\n'}{t('pcCode.guidePost')}
              </Text>

              {/* 6자리 코드 */}
              <View style={[styles.codeBox, expired && styles.codeBoxExpired]}>
                <Text
                  style={[styles.codeText, expired && styles.codeTextExpired]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {spacedCode}
                </Text>
              </View>

              {/* 번호 복사 — 클립보드를 못 쓰는 빌드에서는 버튼 자체를 숨긴다 */}
              {!expired && clip && (
                <TouchableOpacity
                  style={styles.copyBtn}
                  onPress={handleCopy}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={copied ? 'checkmark-circle' : 'copy-outline'}
                    size={20}
                    color={Colors.primary}
                  />
                  <Text style={styles.copyBtnText}>
                    {copied ? t('pcCode.copiedLabel') : t('pcCode.copyLabel')}
                  </Text>
                </TouchableOpacity>
              )}

              {/* 남은 시간 / 만료 안내 */}
              {expired ? (
                <Text style={styles.expiredText}>
                  {t('pcCode.expiredText')}
                </Text>
              ) : (
                <Text style={styles.timeText}>
                  {t('pcCode.validForText')}{'\n'}
                  {t('pcCode.remainingLabel')} <Text style={styles.timeStrong}>{formatRemain(remainSec)}</Text>
                </Text>
              )}

              {/* 번호 다시 받기 */}
              <TouchableOpacity
                style={[styles.primaryBtn, expired ? null : styles.outlineBtn]}
                onPress={onReissue}
                activeOpacity={0.85}
              >
                <Ionicons
                  name="refresh-outline"
                  size={20}
                  color={expired ? Colors.white : Colors.primary}
                />
                <Text style={[styles.primaryBtnText, !expired && styles.outlineBtnText]}>
                  {t('pcCode.reissueBtn')}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {/* 닫기 */}
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.closeBtnText}>{t('common.close')}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </OverlaySheet>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 20,
    width: '100%',
    maxWidth: 440,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 10,
  },
  grabber: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 12,
  },
  headerWrap: {
    alignItems: 'center',
    marginBottom: 16,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
  },

  // 상태(로딩/에러)
  stateBox: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 24,
  },
  stateText: {
    fontSize: 18,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 26,
  },

  guideText: {
    fontSize: 18,
    lineHeight: 28,
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  guideStrong: {
    fontWeight: '800',
    color: Colors.primary,
  },

  codeBox: {
    backgroundColor: Colors.light,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.primary,
    paddingVertical: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    marginBottom: 12,
  },
  codeBoxExpired: {
    backgroundColor: '#F5F5F5',
    borderColor: Colors.border,
  },
  codeText: {
    fontSize: 44,
    fontWeight: '900',
    color: Colors.dark,
    letterSpacing: 6,
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  codeTextExpired: {
    color: Colors.textHint,
  },

  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  copyBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.primary,
  },

  timeText: {
    fontSize: 17,
    lineHeight: 25,
    color: Colors.textSub,
    textAlign: 'center',
    marginBottom: 16,
  },
  timeStrong: {
    fontWeight: '800',
    color: Colors.text,
  },
  expiredText: {
    fontSize: 17,
    lineHeight: 25,
    color: '#C62828',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 16,
  },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
  },
  primaryBtnText: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.white,
  },
  outlineBtn: {
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  outlineBtnText: {
    color: Colors.primary,
  },

  closeBtn: {
    marginTop: 12,
    minHeight: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.border,
  },
  closeBtnText: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textSub,
  },
});

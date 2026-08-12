import React, { useState, useRef, useEffect } from 'react';
import { OverlaySheet } from './OverlaySheet';
import {
  View,
  Image,
  Modal,
  TouchableOpacity,
  ScrollView,
  Text,
  StyleSheet,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Platform,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { R2Image } from './R2Image';
import { getCommunityPhotoUrl } from '../../lib/r2Upload';
import { useTranslation } from 'react-i18next';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CONTENT_PADDING = 20;
const IMAGE_WIDTH = SCREEN_WIDTH - CONTENT_PADDING * 2;

interface Props {
  urls: string[];
  // 풀스크린 직행 모드: 값이 있으면(>=0) 인라인 갤러리 단계를 건너뛰고
  // 해당 인덱스부터 풀스크린 뷰어를 바로 연다. 닫히면 onClose 호출.
  // (일기처럼 썸네일 탭 → 곧바로 원본 전체사이즈로 띄울 때 사용)
  // 값이 없으면(undefined) 기존 인라인 갤러리 + 내부 풀스크린 모달 동작(피드 등).
  initialFullscreenIndex?: number;
  onClose?: () => void;
  // 커뮤니티(정보/나눔) 사진처럼 공개 URL 로 즉시 로딩할지 여부.
  //   true  → 워커 공개 URL(getCommunityPhotoUrl) + 일반 Image (서명 왕복 없음, 빠름)
  //   false → R2Image(서명 URL) — 의료/일기 등 비공개 사진 (기본값)
  publicCommunity?: boolean;
  // 인라인 썸네일의 가로:세로 비율을 직접 지정 — 기본(0.85, contain)은 사용자가 올린
  // 세로/정사각 위주 사진에 맞춘 값이라, 가로로 넓은 소식 글 히어로 이미지에 쓰면
  // 위아래로 회색 여백이 남는다. 지정 시 그 비율에 맞춰 높이를 잡고 resizeMode도 "cover"로
  // 바꿔 여백 없이 꽉 채운다(전체보기 모달에는 영향 없음 — 원본 그대로 보여줘야 하므로 contain 유지).
  imageAspectRatio?: number;
}

export function ImageGalleryViewer({ urls, initialFullscreenIndex, onClose, publicCommunity, imageAspectRatio }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const directFullscreen = initialFullscreenIndex != null;
  const [modalVisible, setModalVisible] = useState(directFullscreen);
  const [currentIndex, setCurrentIndex] = useState(initialFullscreenIndex ?? 0);
  const [fullscreenIndex, setFullscreenIndex] = useState(initialFullscreenIndex ?? 0);
  const fullscreenScrollRef = useRef<ScrollView>(null);

  // 풀스크린 직행 모드: 마운트/인덱스 변경 시 해당 페이지로 스크롤
  useEffect(() => {
    if (!directFullscreen) return;
    setModalVisible(true);
    setFullscreenIndex(initialFullscreenIndex as number);
    const t = setTimeout(() => {
      fullscreenScrollRef.current?.scrollTo({
        x: (initialFullscreenIndex as number) * SCREEN_WIDTH,
        animated: false,
      });
    }, 50);
    return () => clearTimeout(t);
  }, [directFullscreen, initialFullscreenIndex]);

  if (urls.length === 0) return null;

  // 사진 한 장 렌더: 공개 모드면 일반 Image(공개 URL), 아니면 R2Image(서명 URL).
  const renderImage = (url: string, style: any, resizeMode: 'contain' | 'cover' = 'contain') =>
    publicCommunity ? (
      <Image source={{ uri: getCommunityPhotoUrl(url) }} style={style} resizeMode={resizeMode} />
    ) : (
      <R2Image uri={url} style={style} resizeMode={resizeMode} />
    );

  const inlineImageStyle = imageAspectRatio
    ? [styles.mediaImage, { height: IMAGE_WIDTH / imageAspectRatio, backgroundColor: 'transparent' }]
    : styles.mediaImage;
  const inlineResizeMode = imageAspectRatio ? 'cover' : 'contain';

  const closeFullscreen = () => {
    setModalVisible(false);
    onClose?.();
  };

  const handleThumbnailPress = (idx: number) => {
    setFullscreenIndex(idx);
    setCurrentIndex(idx);
    setModalVisible(true);
    // setTimeout으로 ScrollView가 마운트 된 후 스크롤
    setTimeout(() => {
      fullscreenScrollRef.current?.scrollTo({
        x: idx * SCREEN_WIDTH,
        animated: false,
      });
    }, 50);
  };

  const handleFullscreenScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const pageIdx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setFullscreenIndex(pageIdx);
  };

  const handleThumbnailScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const pageIdx = Math.round(e.nativeEvent.contentOffset.x / IMAGE_WIDTH);
    setCurrentIndex(pageIdx);
  };

  return (
    <>
      {/* 본문 사진 — 한 장씩 전체 너비 스와이프 (풀스크린 직행 모드에선 인라인 갤러리 생략) */}
      {!directFullscreen && (
        <View style={styles.galleryWrap}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={styles.mediaScroll}
            onMomentumScrollEnd={handleThumbnailScroll}
            scrollEventThrottle={16}
          >
            {urls.map((url, idx) => (
              <TouchableOpacity
                key={idx}
                onPress={() => handleThumbnailPress(idx)}
                activeOpacity={0.9}
                style={styles.mediaPage}
              >
                {renderImage(url, inlineImageStyle, inlineResizeMode)}
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* 하단 도트 인디케이터 */}
          {urls.length > 1 && (
            <View style={styles.inlineDotsRow}>
              {urls.map((_, idx) => (
                <View
                  key={idx}
                  style={[styles.inlineDot, idx === currentIndex && styles.inlineDotActive]}
                />
              ))}
            </View>
          )}
        </View>
      )}

      {/* 전체보기 — 항상 오버레이로 렌더(앱에서 RN <Modal> 을 전부 제거했다) */}
      <FullscreenHost
        visible={modalVisible}
        onRequestClose={closeFullscreen}
      >
        <View style={styles.modalBg}>
          {/* 상단: X닫기 + 인디케이터 — 노치/다이나믹아일랜드 회피를 위해 insets.top 반영
              (Modal 내부 SafeAreaView 는 iOS 에서 불안정해 paddingTop 방식으로 처리) */}
          <View style={[styles.modalHeader, { paddingTop: insets.top }]}>
            <View style={styles.modalHeaderRow}>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={closeFullscreen}
                activeOpacity={0.8}
              >
                <Ionicons name="close" size={28} color="#fff" />
                <Text style={styles.closeBtnText}>{t('common.close')}</Text>
              </TouchableOpacity>
              <Text style={styles.fullscreenIndicator}>
                {fullscreenIndex + 1}/{urls.length}
              </Text>
            </View>
          </View>

          {/* 이미지 페이지 스와이프 */}
          <ScrollView
            ref={fullscreenScrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleFullscreenScroll}
            scrollEventThrottle={16}
            style={styles.fullscreenScroll}
          >
            {urls.map((url, idx) => (
              <TouchableOpacity
                key={idx}
                style={styles.fullscreenPage}
                onPress={closeFullscreen}
                activeOpacity={1}
              >
                {renderImage(url, styles.fullscreenImage)}
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* 하단 도트 인디케이터 */}
          {urls.length > 1 && (
            <View style={[styles.dotsRow, { bottom: insets.bottom + 16 }]}>
              {urls.map((_, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.dot,
                    idx === fullscreenIndex && styles.dotActive,
                  ]}
                />
              ))}
            </View>
          )}
        </View>
      </FullscreenHost>
    </>
  );
}

/**
 * 전체보기 컨테이너.
 * 항상 절대배치 오버레이로 렌더한다. RN <Modal> 은 별도 네이티브 창이라 겹치면 iOS 에서
 * 굳고 그 위에서 화면 이동도 막히기 때문에, 앱 전체에서 걷어냈다.
 */
function FullscreenHost({
  visible,
  onRequestClose,
  children,
}: {
  visible: boolean;
  onRequestClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onRequestClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onRequestClose]);

  // ⚠️ RN <Modal> 을 쓰지 않는다(inline 분기도 없앴다).
  //   Modal 은 별도 네이티브 창이라 (1) 그 위에서 화면 이동이 안 보이고
  //   (2) 다른 모달과 겹치면 iOS 에서 둘 다 안 닫히고 굳는다.
  //   예전엔 "모달 안에서 열릴 때만" 오버레이로 우회했는데, 우회가 필요한 쪽이 오히려
  //   기본값이어야 한다 — 항상 오버레이로 렌더한다.
  if (!visible) return null;
  return <View style={styles.inlineOverlay}>{children}</View>;
}

const styles = StyleSheet.create({
  galleryWrap: {
    position: 'relative',
    marginTop: 16,
  },
  mediaScroll: {},
  mediaPage: {
    width: IMAGE_WIDTH,
    alignItems: 'center',
  },
  mediaImage: {
    width: IMAGE_WIDTH,
    height: IMAGE_WIDTH * 0.85,
    backgroundColor: '#E0E0E0',
    borderRadius: 12,
    overflow: 'hidden',
  },
  inlineDotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 4,
    gap: 6,
  },
  inlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#CCCCCC',
  },
  inlineDotActive: {
    width: 18,
    borderRadius: 4,
    backgroundColor: '#444444',
  },

  // Modal
  // 전체화면 오버레이 — 부모 트리 안에서 화면 전체를 덮는다.
  inlineOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60,
    elevation: 60,
  },
  modalBg: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  modalHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  closeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 28,
    minHeight: 56,
    minWidth: 90,
  },
  closeBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  fullscreenIndicator: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 20,
  },
  fullscreenScroll: {
    flex: 1,
  },
  fullscreenPage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.75,
  },
  dotsRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  dotActive: {
    backgroundColor: '#fff',
    width: 20,
    borderRadius: 4,
  },
});

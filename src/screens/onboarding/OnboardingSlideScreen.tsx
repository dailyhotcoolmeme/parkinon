import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Dimensions, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { Colors } from '../../constants/colors';
import { PrimaryButton } from '../../components/common/PrimaryButton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SCREEN_WIDTH = Dimensions.get('window').width;

const SLIDES = [
  {
    icon: '💊',
    title: '약 먹는걸 잊지 않게\n챙길 수 있어요.',
    desc: '약 시간이 되면 알려드려요.\n드셨으면 탭 한 번으로 끝이에요.',
  },
  {
    icon: '👨‍👩‍👧',
    title: '가족들도 함께 알 수 있어서\n더욱 안심이에요.',
    desc: '약을 드시면 가족 모두가 알 수 있어요.\n서로 확인하지 않아도 돼요.',
  },
  {
    icon: '📊',
    title: '남긴 기록들은 다음 진료 때\n참고할 수 있어요.',
    desc: '약 먹은 후 몸 상태를 간단히 남겨두면\n시간이 지나면서 변화가 보여요.',
  },
];

type Nav = StackNavigationProp<OnboardingStackParamList, 'OnboardingSlide'>;

export function OnboardingSlideScreen() {
  const navigation = useNavigation<Nav>();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const { bottom: bottomInset } = useSafeAreaInsets();

  const handleNext = async () => {
    if (currentIndex < SLIDES.length - 1) {
      const nextIndex = currentIndex + 1;
      flatListRef.current?.scrollToIndex({ index: nextIndex, animated: true });
      setTimeout(() => setCurrentIndex(nextIndex), 350);
    } else {
      await AsyncStorage.setItem('onboarding_slides_seen', '1');
      navigation.replace('Login');
    }
  };

  const handleSkip = async () => {
    await AsyncStorage.setItem('onboarding_slides_seen', '1');
    navigation.replace('Login');
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
        <Text style={styles.skipText}>건너뛰기</Text>
      </TouchableOpacity>

      <FlatList
        ref={flatListRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}
        keyExtractor={(_, i) => String(i)}
        getItemLayout={(_, index) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * index,
          index,
        })}
        renderItem={({ item }) => (
          <View style={styles.slide}>
            <Text style={styles.icon}>{item.icon}</Text>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.desc}>{item.desc}</Text>
          </View>
        )}
      />

      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[styles.dot, i === currentIndex && styles.dotActive]} />
        ))}
      </View>

      <View style={[styles.btnWrapper, { paddingBottom: 40 + bottomInset }]}>
        <PrimaryButton
          title={currentIndex < SLIDES.length - 1 ? '다음' : '시작하기'}
          onPress={handleNext}
          variant="outline"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primary },
  skipBtn: { position: 'absolute', top: 56, right: 24, zIndex: 10, padding: 8 },
  skipText: { fontSize: 16, color: '#FFFFFF' },
  slide: {
    width: SCREEN_WIDTH,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  icon: { fontSize: 80, marginBottom: 40 },
  title: { fontSize: 24, fontWeight: '700', color: '#FFFFFF', textAlign: 'center', lineHeight: 36, marginBottom: 16 },
  desc: { fontSize: 18, color: '#FFFFFF', textAlign: 'center', lineHeight: 28 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255, 255, 255, 0.4)' },
  dotActive: { backgroundColor: '#FFFFFF', width: 24 },
  btnWrapper: { paddingHorizontal: 24 },
});

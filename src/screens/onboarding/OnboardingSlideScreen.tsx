import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Dimensions, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { Colors } from '../../constants/colors';
import { PrimaryButton } from '../../components/common/PrimaryButton';

const { width } = Dimensions.get('window');

const SLIDES = [
  {
    emoji: '💊',
    title: '약 먹는걸 잊지 않게\n챙길 수 있어요.',
    desc: '약 시간이 되면 알려드려요.\n드셨으면 탭 한 번으로 끝이에요.',
  },
  {
    emoji: '👨‍👩‍👧',
    title: '가족들도 함께 알 수 있어서\n더욱 안심이에요.',
    desc: '약을 드시면 가족 모두가 알 수 있어요.\n서로 확인하지 않아도 돼요.',
  },
  {
    emoji: '📊',
    title: '남긴 기록들은 다음 진료 때\n참고할 수 있어요.',
    desc: '약 먹은 후 몸 상태를 간단히 남겨두면\n시간이 지나면서 변화가 보여요.',
  },
];

type Nav = StackNavigationProp<OnboardingStackParamList, 'OnboardingSlide'>;

export function OnboardingSlideScreen() {
  const navigation = useNavigation<Nav>();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const handleNext = async () => {
    if (currentIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1 });
      setCurrentIndex(currentIndex + 1);
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
        renderItem={({ item }) => (
          <View style={styles.slide}>
            <Text style={styles.emoji}>{item.emoji}</Text>
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

      <View style={styles.btnWrapper}>
        <PrimaryButton
          title={currentIndex < SLIDES.length - 1 ? '다음' : '시작하기'}
          onPress={handleNext}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.white },
  skipBtn: { position: 'absolute', top: 56, right: 24, zIndex: 10, padding: 8 },
  skipText: { fontSize: 16, color: Colors.textSub },
  slide: {
    width,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emoji: { fontSize: 80, marginBottom: 32 },
  title: { fontSize: 24, fontWeight: '700', color: Colors.text, textAlign: 'center', lineHeight: 36, marginBottom: 16 },
  desc: { fontSize: 18, color: Colors.textSub, textAlign: 'center', lineHeight: 28 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.border },
  dotActive: { backgroundColor: Colors.primary, width: 24 },
  btnWrapper: { paddingHorizontal: 24, paddingBottom: 40 },
});

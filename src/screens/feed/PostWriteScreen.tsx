import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const CATEGORIES: { id: string; icon: IoniconName; label: string }[] = [
  { id: 'chat', icon: 'chatbubble-outline', label: '자유수다' },
  { id: 'question', icon: 'help-circle-outline', label: '질문있어요' },
  { id: 'info', icon: 'megaphone-outline', label: '정보공유' },
  { id: 'exercise', icon: 'fitness-outline', label: '운동인증' },
];

export function PostWriteScreen() {
  const navigation = useNavigation();
  const [selectedCategory, setSelectedCategory] = useState<string>('chat');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const handleSubmit = () => {
    if (!selectedCategory) {
      Alert.alert('글 유형 선택', '글 유형을 선택해주세요.');
      return;
    }
    if (!title.trim()) {
      Alert.alert('제목 입력', '제목을 입력해주세요.');
      return;
    }
    if (!content.trim()) {
      Alert.alert('내용 입력', '내용을 입력해주세요.');
      return;
    }
    Alert.alert('등록 완료', '글이 등록되었어요.', [
      { text: '확인', onPress: () => navigation.goBack() },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar
        title="글쓰기"
        showBack
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={60}
      >
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* 글 유형 선택 */}
          <Text style={styles.sectionLabel}>글 유형 선택</Text>
          <View style={styles.categoryRow}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.categoryBtn,
                  selectedCategory === cat.id && styles.categoryBtnSelected,
                ]}
                onPress={() => setSelectedCategory(cat.id)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={cat.icon}
                  size={28}
                  color={selectedCategory === cat.id ? Colors.primary : Colors.textSub}
                />
                <Text
                  style={[
                    styles.categoryLabel,
                    selectedCategory === cat.id && styles.categoryLabelSelected,
                  ]}
                  numberOfLines={1}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 제목 */}
          <TextInput
            style={styles.titleInput}
            placeholder="제목을 입력해주세요"
            placeholderTextColor={Colors.textHint}
            value={title}
            onChangeText={setTitle}
            maxLength={50}
            returnKeyType="next"
          />

          <View style={styles.divider} />

          {/* 내용 */}
          <TextInput
            style={styles.contentInput}
            placeholder="내용을 입력해주세요"
            placeholderTextColor={Colors.textHint}
            value={content}
            onChangeText={setContent}
            multiline
            textAlignVertical="top"
            maxLength={2000}
          />

          <View style={styles.divider} />

          {/* 사진 추가 */}
          <TouchableOpacity
            style={styles.photoBtn}
            onPress={() => Alert.alert('사진 추가', '사진 선택 기능은 준비 중이에요.')}
            activeOpacity={0.7}
          >
            <Ionicons name="camera-outline" size={22} color={Colors.textSub} />
            <Text style={styles.photoText}>사진 추가</Text>
            <Text style={styles.photoHint}>최대 5장</Text>
          </TouchableOpacity>
        </ScrollView>

        <View style={styles.bottomActions}>
          <TouchableOpacity style={styles.bottomMainBtn} onPress={handleSubmit} activeOpacity={0.85}>
            <Text style={styles.bottomMainBtnText}>등록하기</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.white },
  flex: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textSub,
    marginBottom: 12,
  },
  categoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 20,
  },
  categoryBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  categoryBtnSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
  },
  categoryLabel: { fontSize: 13, fontWeight: '700', color: Colors.textSub, textAlign: 'center' },
  categoryLabelSelected: { color: Colors.dark },
  titleInput: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    paddingVertical: 14,
    paddingHorizontal: 0,
    minHeight: 52,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 4,
  },
  contentInput: {
    fontSize: 16,
    color: Colors.text,
    paddingVertical: 14,
    paddingHorizontal: 0,
    minHeight: 200,
    lineHeight: 26,
  },
  photoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  photoText: { fontSize: 16, fontWeight: '600', color: Colors.textSub, flex: 1 },
  photoHint: { fontSize: 13, color: Colors.textHint },
  bottomActions: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 20 : 16,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  bottomMainBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomMainBtnText: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: '700',
  },
});

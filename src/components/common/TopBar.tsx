import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Colors } from '../../constants/colors';
import { navigateTo } from '../../navigation/navigationRef';

interface Props {
  title: string;
  showBack?: boolean;
  showClose?: boolean;
  showParkinon?: boolean;
  rightIcon?: React.ReactNode;
}

export function TopBar({ title, showBack, showClose, showParkinon, rightIcon }: Props) {
  const navigation = useNavigation();

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        <View style={styles.left}>
          {showParkinon && (
            <TouchableOpacity
              onPress={() => navigateTo('Medication')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.parkinonText}>파킨온</Text>
            </TouchableOpacity>
          )}
          {showBack && (
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.backBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="arrow-back" size={24} color={Colors.textSub} />
              <Text style={styles.backText}>뒤로</Text>
            </TouchableOpacity>
          )}
          {showClose && (
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.closeBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={28} color={Colors.textSub} />
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.right}>
          {rightIcon}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  inner: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  left: { width: 76, alignItems: 'flex-start' },
  right: { width: 76, alignItems: 'flex-end' },
  title: { flex: 1, fontSize: 20, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  parkinonText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FF6B35',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  backText: { fontSize: 18, color: Colors.textSub, fontWeight: '600' },
  closeBtn: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

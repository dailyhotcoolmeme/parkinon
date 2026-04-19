import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Colors } from '../../constants/colors';
import { navigateTo } from '../../navigation/navigationRef';

interface Props {
  title?: string;
  showBack?: boolean;
  showClose?: boolean;
  showParkinon?: boolean;
  rightIcon?: React.ReactNode;
  rightComponent?: React.ReactNode;
  showBell?: boolean;
  onBellPress?: () => void;
}

export function TopBar({ title, showBack, showClose, showParkinon, rightIcon, rightComponent, showBell, onBellPress }: Props) {
  const navigation = useNavigation();

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        <View style={[styles.left, showParkinon && styles.leftExpanded]}>
          {showParkinon && (
            <TouchableOpacity
              onPress={() => navigateTo('Medication')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Image
                source={require('../../../assets/parkinon-logo.png')}
                style={{ width: 28, height: 28, borderRadius: 6 }}
              />
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
              <Ionicons name="close" size={24} color={Colors.textSub} />
              <Text style={styles.backText}>닫기</Text>
            </TouchableOpacity>
          )}
        </View>
        {!showParkinon && !!title && <Text style={styles.title}>{title}</Text>}
        <View style={styles.right}>
          {rightComponent ?? rightIcon ?? (showBell ? (
            <TouchableOpacity onPress={onBellPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="notifications-outline" size={26} color={Colors.textSub} />
            </TouchableOpacity>
          ) : null)}
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
  leftExpanded: { width: 'auto', flex: 1 },
  right: { width: 76, alignItems: 'flex-end' },
  title: { flex: 1, fontSize: 20, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  parkinonText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#4CAF50',
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 8,
    justifyContent: 'center',
  },
});

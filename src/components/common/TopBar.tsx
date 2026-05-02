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
  bellBadge?: number;
  onBellPress?: () => void;
}

export function TopBar({ title, showBack, showClose, showParkinon, rightIcon, rightComponent, showBell, bellBadge, onBellPress }: Props) {
  const navigation = useNavigation();

  const badgeLabel = bellBadge && bellBadge > 0
    ? bellBadge > 99 ? '99+' : String(bellBadge)
    : null;

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
            <TouchableOpacity
              onPress={onBellPress}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.bellWrap}
            >
              <Ionicons name="notifications-outline" size={26} color={Colors.textSub} />
              {badgeLabel && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badgeLabel}</Text>
                </View>
              )}
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
    minHeight: 56,
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
  bellWrap: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#E53935',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

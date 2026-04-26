import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';
import { Colors } from '../../constants/colors';

interface Props {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'dark' | 'outline' | 'danger';
  style?: ViewStyle;
}

export function PrimaryButton({ title, onPress, loading, disabled, variant = 'primary', style }: Props) {
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      style={[styles.base, styles[isDisabled ? 'disabled' : variant], style]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={Colors.white} size="small" />
      ) : (
        <Text style={[styles.text, isDisabled ? styles.textDisabled : styles[`text_${variant}`]]}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 56,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  primary: { backgroundColor: Colors.primary },
  dark: { backgroundColor: Colors.dark },
  outline: { backgroundColor: Colors.white, borderWidth: 2, borderColor: Colors.white },
  danger: { backgroundColor: Colors.white },
  disabled: { backgroundColor: Colors.border },
  text: { fontSize: 18, fontWeight: '700' },
  text_primary: { color: Colors.white },
  text_dark: { color: Colors.white },
  text_outline: { color: Colors.primary },
  text_danger: { color: Colors.danger },
  textDisabled: { color: Colors.textHint },
});

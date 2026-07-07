import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle, TextStyle } from 'react-native';

/**
 * "💡 Enter the hospital..." 처럼 이모지/기호로 시작하는 문구용 Text 대체.
 * 그냥 <Text>{'💡 ' + text}</Text> 로 렌더하면, 길어서 줄바꿈될 때 둘째 줄이
 * 이모지 자리(왼쪽 끝)로 내려가 첫 줄 텍스트 시작 위치와 안 맞는다(행잉 인덴트 위반).
 * 이모지를 별도 Text로 분리해 alignItems:'flex-start' 행에 넣으면, 본문이
 * 줄바꿈돼도 둘째 줄이 본문 시작 위치에 맞는다. (전역 규칙 — 새 화면에서도 이걸 쓸 것)
 */
export function splitLeadingIcon(text: string): { icon: string; rest: string } {
  const m = text.match(/^(\S+)\s(.+)$/s);
  if (!m) return { icon: '', rest: text };
  const [, first, rest] = m;
  // 첫 "단어"가 문자/숫자로 시작하면 이모지가 아니라 그냥 첫 단어 — 분리하지 않는다.
  if (/^[\p{L}\p{N}]/u.test(first)) return { icon: '', rest: text };
  return { icon: first, rest };
}

export function HangingText({
  text,
  style,
  containerStyle,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const { icon, rest } = splitLeadingIcon(text);
  if (!icon) return <Text style={style}>{text}</Text>;
  return (
    <View style={[styles.row, containerStyle]}>
      <Text style={style}>{icon} </Text>
      <Text style={[style, styles.flex]}>{rest}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  flex: { flex: 1 },
});

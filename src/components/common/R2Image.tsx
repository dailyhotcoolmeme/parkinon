/**
 * R2Image — 저장된 R2 미디어 URL(또는 key)을 presigned GET URL 로 변환해 표시하는 Image 래퍼.
 *
 * Phase 1 정책(깨짐 0 보장):
 *   - 초기엔 원본(공개 URL)을 그대로 그려 즉시 표시.
 *   - presigned 발급이 끝나면 source 를 교체. 발급 실패/지연 시 원본이 남아 항상 보임.
 *   - 비R2(유튜브/로컬 등)면 resolveMediaUrl 이 원본을 그대로 반환하므로 무해.
 *
 * 일반 <Image> 와 동일하게 쓰되, source 대신 `uri`(string) 를 넘긴다.
 */
import React from 'react';
import { Image, ImageProps } from 'react-native';
import { useResolvedMediaUrl } from '../../lib/r2Get';

type R2ImageProps = Omit<ImageProps, 'source'> & {
  uri: string;
};

export function R2Image({ uri, ...rest }: R2ImageProps) {
  const { uri: resolvedUri } = useResolvedMediaUrl(uri);
  return <Image source={{ uri: resolvedUri }} {...rest} />;
}

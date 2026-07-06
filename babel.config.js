module.exports = function (api) {
  api.cache(true);

  // 릴리스(프로덕션) 빌드/OTA 번들에서만 console.* 제거 → 로그 노출 방지.
  // - 개발(__DEV__, NODE_ENV !== 'production')에서는 로그 유지.
  // - error/warn 은 남겨 운영 중 문제 추적 가능하게 둔다.
  // 순수 babel 트랜스폼 플러그인이라 네이티브/빌드에 영향 없음(OTA 안전).
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    process.env.BABEL_ENV === 'production' ||
    process.env.EAS_BUILD_PROFILE === 'production';

  const plugins = [];
  if (isProduction) {
    plugins.push(['transform-remove-console', { exclude: ['error', 'warn'] }]);
  }

  return {
    presets: ['babel-preset-expo'],
    plugins,
  };
};

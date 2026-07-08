// expo.locales(iOS 표시명 로컬라이즈)가 Android 리소스에도 CFBundleDisplayName 문자열을
// 만들어, 릴리즈 lint 의 ExtraTranslation("기본 로케일에 없는 번역") 검사가 빌드를 막는다.
// CFBundleDisplayName 은 iOS 전용이라 Android 에선 무의미 → 해당 lint 검사만 끈다.
const { withAppBuildGradle } = require('@expo/config-plugins');

module.exports = function withDisableExtraTranslationLint(config) {
  return withAppBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (contents.includes("disable 'ExtraTranslation'")) return cfg; // 멱등
    contents = contents.replace(
      /android\s*\{/,
      (m) => `${m}\n    lint {\n        disable 'ExtraTranslation'\n    }`,
    );
    cfg.modResults.contents = contents;
    return cfg;
  });
};

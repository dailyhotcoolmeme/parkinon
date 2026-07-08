// prebuild --clean 이 android/build.gradle 을 재생성하면서 빠지는 Maven 저장소를 보강한다.
//  - Kakao SDK(com.kakao.sdk:*)  → https://devrepo.kakao.com/...
//  - notifee(app.notifee:core:+) → node_modules 안의 로컬 AAR($rootDir 기준 상대경로)
// expo-build-properties.extraMavenRepos 는 allprojects 각 프로젝트 기준으로 상대경로가 어긋나
//   notifee 로컬 경로엔 부적합 → build.gradle 에 직접 $rootDir 기반으로 주입(이식성 O).
const { withProjectBuildGradle } = require('@expo/config-plugins');

const MARKER = '// parkinon-extra-maven-repos';
const REPOS = `
        ${MARKER}
        maven { url 'https://devrepo.kakao.com/nexus/content/groups/public/' }
        maven { url "$rootDir/../node_modules/@notifee/react-native/android/libs" }`;

module.exports = function withExtraMavenRepos(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg;
    let contents = cfg.modResults.contents;
    if (contents.includes(MARKER)) return cfg; // 이미 주입됨(멱등)
    // allprojects { repositories { ... } 블록 시작 직후에 저장소 추가.
    const re = /(allprojects\s*\{\s*repositories\s*\{)/;
    if (re.test(contents)) {
      contents = contents.replace(re, (m) => m + REPOS);
    }
    cfg.modResults.contents = contents;
    return cfg;
  });
};

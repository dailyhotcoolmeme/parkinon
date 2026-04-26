# FCM 서버 키 EAS 업로드 가이드

## 현재 상황
- `google-services.json` 존재 ✅
- FCM 서버 키 EAS 미업로드 ❌ ← **문제 원인**
- push_token = null → 모든 서버 푸시 알림 작동 안 함

## 해결 방법

### 1단계: Firebase 콘솔에서 서버 키 확인

1. https://console.firebase.google.com/ 접속
2. 프로젝트 선택: **parkinon-1fb4f**
3. 왼쪽 메뉴 → ⚙️ 프로젝트 설정
4. 상단 탭 → **Cloud Messaging**
5. **서버 키** 복사 (또는 **Cloud Messaging API (Legacy)** 활성화)

### 2단계: EAS에 서버 키 업로드

터미널에서 실행:

```bash
cd /Users/ourmine/Desktop/parkinon-app
npx eas credentials
```

선택:
1. Platform: **Android**
2. Build profile: **production**
3. **Add new credentials**
4. **FCM Server Key**
5. 복사한 서버 키 붙여넣기

또는 자동 설정:
```bash
npx eas build:configure --platform android
```

### 3단계: 앱 재빌드 (필수)

FCM 설정 변경은 OTA 불가 → APK 재빌드 필요:

```bash
npx eas build --platform android --profile production
```

빌드 완료 후 새 APK 설치.

### 4단계: 확인

앱 실행 → 메뉴 → 알림 설정 → **"알림 토큰 재등록"** 버튼 클릭

성공 메시지:
```
알림 토큰이 등록되었습니다!
토큰: ExponentPushToken[xxxxxx]...
```

## 대안: Legacy FCM 활성화 확인

Firebase 콘솔에서 Cloud Messaging API (Legacy)가 **활성화**되어 있어야 합니다.

1. Firebase Console → 프로젝트 설정 → Cloud Messaging
2. **Cloud Messaging API (Legacy)** → Enable

---

## 참고: 현재 알림 상태

| 알림 | 작동 여부 | 이유 |
|------|-----------|------|
| 약 복용 시간 알림 | ❌ | push_token null |
| 약 미복용 경고 | ❌ | push_token null |
| 약효 추적 알림 | ❌ | push_token null |
| 보호자 알림 (약/몸상태/운동) | ❌ | push_token null |
| 운동 알림 | ✅ | 로컬 알림 |

FCM 설정 완료 → push_token 등록 → 모든 알림 정상 작동

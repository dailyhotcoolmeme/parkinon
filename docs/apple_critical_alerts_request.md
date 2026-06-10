# Apple Critical Alerts Entitlement — 신청 소명 문구 (초안)

> 제출처: developer.apple.com → Account → Critical Alerts 요청 폼.
> 앱 출시 전에도 신청 가능. 계정 + 번들ID만 있으면 됨.
> 핵심: "약 복용 타이밍이 의료적으로 중요 → 무음/방해금지 뚫어야 안전". 절제된 사용 + 사용자 opt-in 강조(과용으로 보이면 거절).

---

## 영문 (Apple 제출용)

**App:** ParkinON — a medication and care app for people with Parkinson's disease and their family caregivers.

**Why we need the Critical Alerts entitlement**

ParkinON's core purpose is reminding patients to take Parkinson's medication on time. In Parkinson's disease, dose timing is medically critical: a delayed or missed dose causes "OFF" episodes — loss of motor control, freezing of gait, falls, and immobility — which are immediate safety risks. The large majority of our users are elderly (60+) patients.

These users frequently keep their phone in silent mode or Do Not Disturb / sleep Focus, especially at night and in care settings, so standard notifications are silently missed. For this population a missed dose is not a minor inconvenience — it is a health and fall-risk event. We therefore need medication reminders to reliably break through silent mode and Focus.

**Scope and restraint**
- Critical Alerts will be used ONLY for (1) time-sensitive medication reminders and (2) missed-dose escalation alerts — never for marketing or general notifications.
- Use is explicitly user-controlled: an in-app opt-in toggle lets each user turn the "ring even in silent mode" behavior on or off at any time, in addition to the system Critical Alerts permission prompt.
- Volume and frequency are limited to scheduled dose times and the necessary missed-dose follow-ups.

**Precedent:** Apple's own Health app uses Critical Alerts for medication reminders. Our use case is the same category of time-critical medication adherence for a vulnerable patient group.

We respectfully request the Critical Alerts entitlement so that vulnerable Parkinson's patients can take their medication safely and on time.

---

## 국문 (오너 검토용)

**앱:** 파킨온(ParkinON) — 파킨슨병 환자와 가족 보호자를 위한 약 복용·돌봄 앱.

**왜 Critical Alerts가 필요한가**

파킨온의 핵심은 환자가 파킨슨 약을 **제때** 복용하도록 알리는 것입니다. 파킨슨병은 **복용 타이밍이 의료적으로 매우 중요**합니다 — 약을 늦게/거르면 "OFF" 상태(운동 조절 상실, 보행 동결, 낙상, 거동 불가)가 와서 **즉각적인 안전 위험**이 됩니다. 사용자 대부분은 60대 이상 고령 환자입니다.

이분들은 특히 밤이나 요양 환경에서 **무음 모드나 방해금지(집중 모드)**를 켜두는 경우가 많아, 일반 알림은 소리 없이 지나갑니다. 이 집단에게 약을 거르는 것은 사소한 불편이 아니라 **건강·낙상 위험 사건**입니다. 그래서 약 복용 알림이 **무음·방해금지를 확실히 뚫고** 전달돼야 합니다.

**절제된 사용**
- Critical Alerts는 오직 ① 시간이 중요한 약 복용 알림, ② 미복용 경과 알림에만 사용 — 마케팅·일반 알림에는 절대 사용 안 함.
- 사용자 제어: 앱 내 옵트인 토글로 "무음에도 울리기"를 **언제든 켜고 끌 수 있음**(시스템 권한 프롬프트와 별개).
- 빈도·볼륨은 예약된 복용 시간 + 필요한 미복용 후속에 한정.

**선례:** Apple 자체 건강(Health) 앱도 약 복용 알림에 Critical Alerts를 사용. 동일하게 취약 환자군의 시간-결정적 복약 순응 목적.

취약한 파킨슨 환자가 안전하게 제때 약을 복용하도록 Critical Alerts 권한을 요청드립니다.

---

## 제출 팁
- 폼에 앱 이름/번들ID/설명을 사실대로 기입.
- **opt-in + 절제**를 강조(과용 인상 주면 거절). 위 문구에 이미 반영.
- TestFlight/개발 빌드가 있으면 설득에 도움(필수는 아님).
- 승인까지 수 주~ 무응답 사례도 있음 → 회신 없으면 정중히 follow-up.
- 거절 시: iOS는 무음 뚫기 불가 → 그땐 "일반 알림 + 개인화 녹음음"까지만 iOS 제공, 무음뚫기는 Android 중심으로 운영하는 fallback 검토.

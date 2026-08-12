# 스토어 등록정보 — 다음 업데이트 때 반드시 반영할 것

콘솔에서만 고칠 수 있어 코드/배포로는 처리가 안 되는 항목을 모아 둔다.
**앱 업데이트를 제출할 때마다 이 문서를 먼저 열 것.**

---

## 1. 영어 설명문의 caregiver → care partner (2026-08-12 등록)

앱 UI·웹사이트·영어 약관은 전부 `care partner` 로 바꿨는데(아래 근거),
**미국 App Store / Google Play 설명문만 아직 `caregiver` 로 남아 있다.**

현재 미국 App Store 설명문에 3군데 (2026-08-12 조회 기준):

```
- If a dose is missed, you get a follow-up reminder and your caregiver is notified too
- Patients and caregivers link accounts to see each other's records
- Caregivers are notified when the patient takes medication or logs how they feel
```

고칠 문구(제안):

```
- If a dose is missed, you get a follow-up reminder and your care partner is notified too
- You and your care partner link accounts to see each other's records
- Your care partner is notified when you take medication or log how you feel
```

`Patients and caregivers` 는 단순 치환보다 위처럼 "you / your care partner" 로 바꾸는 편이
낫다 — 조사한 미국 단체들이 독자를 직접 호칭하고 `patient` 를 쓰지 않기 때문이다.

**근거**: Parkinson's Foundation 공식 용어가 "Care Partner"("For Care Partners" 섹션),
Michael J. Fox Foundation·Parkinson's UK 도 `patient`·`sufferer` 를 쓰지 않는다.
자세한 기준은 `parkinon-web/site/docs/en-style-guide.md`.

### 다른 언어는?
- **프랑스어**: `proche aidant` 이 표준(France Parkinson·Parkinson Québec 공통). 앱은 이미 통일함.
  스토어 프랑스어 설명문이 있다면 같이 확인할 것.
- **일본어**: **바꾸지 말 것.** `ケアパートナー` 는 일본 파킨슨 자료에서 쓰이지 않는다.
  `ご家族`·`介護者` 가 표준이고 `患者さん` 은 존중 표현으로 정상이다.

---

## 확인 방법

스토어에 실제로 올라간 설명문은 아래로 바로 볼 수 있다(콘솔 로그인 없이도 됨).

```
curl -s "https://itunes.apple.com/lookup?id=6773573590&country=us" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['results'][0]['description'])"
```

---

## 참고: 구독 상품 ID·무료체험 작동 확인 (2026-08-12)

계획 문서에 "상품 ID가 코드 어디에도 없다"고 적혀 있었는데, 코드에 없는 게 맞고
(RevenueCat 이 packageType 으로 고르는 구조) **실제 상품 ID 는 아래와 같다.**
`revenuecat_events` 웹훅 기록에서 확인.

| 스토어 | product_id |
|---|---|
| Google Play | `premium_monthly:monthly` |
| App Store | `com.ourmine.parkinon.premium.monthly` |

**7일 무료체험은 양 스토어에서 실제로 작동한다.** 추정이 아니라 웹훅 기록으로 확인:
`INITIAL_PURCHASE` 이면서 `period_type = TRIAL` 인 이벤트가 Play 4건·App Store 1건 있고,
체험 취소(CANCELLATION/TRIAL)·만료(EXPIRATION/TRIAL) 도 정상 수신됐으며, 이후
NORMAL 갱신까지 이어졌다(체험 → 유료 전환 경로 완주). 전부 2026-07-27~28 테스트 기록.

확인 쿼리:
```sql
select event_type, payload->'event'->>'period_type' as period_type,
       payload->'event'->>'store' as store, count(*)
from revenuecat_events group by 1,2,3;
```

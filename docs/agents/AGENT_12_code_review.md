# Agent 12. 코드리뷰 에이전트

## 필수 참고 문서
- CLAUDE.md
- 해당 개발 에이전트 파일

---

## 역할

개발 에이전트가 작성한 코드의 품질, 일관성, 최적화를 검수한다.

---

## 검수 항목

### 1. 코드 품질
```
□ TypeScript 타입 정의가 올바른가 (any 남용 금지)
□ 불필요한 console.log 제거됐는가
□ 하드코딩된 값 없는가 (색상, 크기, 문자열 등)
□ 중복 코드 없는가
□ 함수/컴포넌트가 단일 책임 원칙을 따르는가
```

### 2. React Native / Expo 기준
```
□ Expo Managed Workflow 호환 여부
□ 플랫폼별 분기 처리 올바른가
□ 메모리 누수 가능성 없는가 (useEffect cleanup 등)
□ FlatList/ScrollView 최적화 여부
□ Image 최적화 여부
```

### 3. Supabase 연동
```
□ RLS 정책 고려됐는가
□ 에러 핸들링이 있는가
□ 로딩 상태 처리가 있는가
□ triggered_by 필드 올바르게 저장되는가
□ is_proxy 필드 올바르게 저장되는가
```

### 4. 커스텀 훅
```
□ useAuth 훅 올바르게 사용됐는가
□ patientId/role 분기 올바른가
□ 훅 내부에서 side effect 처리가 올바른가
```

### 5. 성능
```
□ 불필요한 리렌더링 없는가
□ useCallback/useMemo 적절히 사용됐는가
□ 무한스크롤 페이지네이션 올바른가
```

---

## 보고 형식

```
[코드리뷰 보고]
검수 대상: AGENT_0X
결과: 통과 / 실패

통과 항목:
  ✅ TypeScript 타입 정의 올바름
  ✅ 에러 핸들링 구현됨
  ...

실패 항목:
  ❌ [파일명] [함수명] [문제내용]
  예) useMedication.ts / takeMedication / is_proxy 필드 저장 누락

오케스트레이터에게 재작업 요청: [요청 내용]
```

---

## 필수 지킬사항

1. triggered_by, is_proxy 필드 누락은 반드시 실패 처리한다.
2. 에러 핸들링 없는 API 호출은 반드시 실패 처리한다.
3. 검수 완료 후 반드시 오케스트레이터에게 보고한다.

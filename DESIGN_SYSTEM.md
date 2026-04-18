# 파킨온 디자인 시스템

모든 에이전트는 이 문서를 반드시 참고하여 일관된 UI/UX를 구현한다.
참고 파일: design_system.jsx

---

## 1. 컬러 팔레트

```
Primary:   #4CAF50  ← 메인 초록 (버튼, 활성 상태, 탭바 선택)
Dark:      #2E7D32  ← 진한 초록 (강조 텍스트, 저장 버튼)
Light:     #E8F5E9  ← 연한 초록 (선택된 카드 배경, 활성 입력 배경)
Accent:    #FF9800  ← 주황 (알림, 약효 패턴 그래프)
Danger:    #F44336  ← 빨강 (삭제 버튼, 경고, 나쁨 상태)

Background: #F5F5F5  ← 앱 전체 배경
White:      #FFFFFF  ← 카드/섹션 배경
Text:       #111111  ← 본문 텍스트
TextSub:    #666666  ← 보조 텍스트
TextHint:   #AAAAAA  ← 힌트/비활성 텍스트
Border:     #EEEEEE  ← 구분선/테두리
```

---

## 2. 타이포그래피

60대 이상 타겟. 절대 이 기준 이하로 내리지 말 것.

```
제목:       24sp / Bold   / #111111
소제목:     20sp / Bold   / #111111
본문 강조:  18sp / SemiBold / #111111  ← 최소 본문 크기
본문:       16sp / Regular / #111111
보조 텍스트: 14sp / Regular / #666666
힌트:       12sp / Regular / #AAAAAA
```

---

## 3. 버튼

### 주요 버튼 (Primary)
```
background: #4CAF50
color: #FFFFFF
fontSize: 18sp
fontWeight: 700
borderRadius: 12
padding: 16px
width: 100%
minHeight: 56dp
```

### 강조 버튼 (Dark)
```
background: #2E7D32
color: #FFFFFF
fontSize: 18sp
fontWeight: 700
borderRadius: 12
padding: 16px
width: 100%
minHeight: 56dp
```

### 아웃라인 버튼
```
background: #FFFFFF
border: 2px solid #4CAF50
color: #4CAF50
fontSize: 18sp
fontWeight: 700
borderRadius: 12
padding: 16px
width: 100%
minHeight: 56dp
```

### 비활성화 버튼
```
background: #EEEEEE
color: #AAAAAA
fontSize: 18sp
fontWeight: 700
borderRadius: 12
padding: 16px
width: 100%
minHeight: 56dp
cursor: default
```

### 삭제 버튼
```
background: #FFFFFF
color: #F44336
fontSize: 18sp
fontWeight: 700
borderRadius: 12
padding: 16px
width: 100%
minHeight: 56dp
```

---

## 4. 입력 필드

### 활성 (포커스)
```
border: 1.5px solid #4CAF50
borderRadius: 10
padding: 14px 16px
fontSize: 18sp
color: #111111
background: #FFFFFF
```

### 비활성
```
border: 1.5px solid #EEEEEE
borderRadius: 10
padding: 14px 16px
fontSize: 18sp
color: #111111
background: #FFFFFF
```

### 드롭다운
```
border: 1.5px solid #EEEEEE
borderRadius: 10
padding: 14px 16px
fontSize: 18sp
오른쪽에 ▼ 아이콘
```

---

## 5. 카드

### 일반 카드
```
background: #FFFFFF
borderRadius: 16
padding: 20px
marginBottom: 12
boxShadow: 0 1px 6px rgba(0,0,0,0.06)
```

### 활성/완료 카드
```
background: #E8F5E9
borderRadius: 12
padding: 16px
```

### 비활성 카드
```
background: #F9F9F9
borderRadius: 12
padding: 16px
```

### 경고 카드
```
background: #FFF3E0
borderRadius: 12
padding: 16px
borderLeft: 4px solid #FF9800
```

### 위험 카드
```
background: #FFEBEE
borderRadius: 12
padding: 16px
borderLeft: 4px solid #F44336
```

---

## 6. 선택 컴포넌트

### 선택된 상태
```
border: 2px solid #4CAF50
background: #E8F5E9
borderRadius: 10
padding: 14px
fontSize: 18sp
fontWeight: 700
color: #2E7D32
```

### 미선택 상태
```
border: 1.5px solid #EEEEEE
background: #FFFFFF
borderRadius: 10
padding: 14px
fontSize: 18sp
color: #666666
```

### 1~5점 선택 (몸상태 입력)
```
각 버튼 flex: 1
height: 52dp
borderRadius: 10
선택: border 2px solid #4CAF50, background #E8F5E9
미선택: border 1.5px solid #EEEEEE
숫자 fontSize: 20sp
```

---

## 7. 토글

```
ON:  background #4CAF50, 핸들 오른쪽
OFF: background #CCCCCC, 핸들 왼쪽
크기: width 52, height 30
핸들: width 24, height 24, borderRadius 50%, background #FFFFFF
```

---

## 8. 탭바

```
높이: 60dp 이상
배경: #FFFFFF
상단 테두리: 1px solid #EEEEEE
아이콘: 26sp
라벨: 12sp
활성 색상: #4CAF50 + 하단 점(dot) 표시
비활성 색상: #AAAAAA
```

---

## 9. 탑바

```
배경: #FFFFFF
높이: 60dp
하단 테두리: 1px solid #EEEEEE
타이틀: 20sp Bold #111111 (가운데)
왼쪽: ← 뒤로가기 or ≡ 햄버거
오른쪽: 📅 달력 or 기타 아이콘
```

---

## 10. 구분선

```
height: 1px
background: #EEEEEE
margin: 12px 0
```

---

## 11. 플로팅 버튼 (FAB)

```
처음: ✏️ 글쓰기 텍스트+아이콘 (넓은 버튼)
  background: #4CAF50
  color: #FFFFFF
  borderRadius: 28
  padding: 14px 20px
  fontSize: 16sp
  fontWeight: 700

스크롤 내리면: 아이콘만
  width: 56dp
  height: 56dp
  borderRadius: 50%

스크롤 올리면: 다시 텍스트+아이콘
```

---

## 12. UX 원칙

- 화면당 핵심 정보 최대 2개
- 버튼은 항상 하단에 위치
- 텍스트 입력 최소화 → 탭/선택 위주
- 스와이프 제스처 최소화
- 아이콘은 반드시 텍스트와 함께
- 비활성 버튼은 회색 처리 + 안내 문구 필수
- 삭제/위험 액션은 빨간색 + 확인 절차 필수
- 굳이 한 화면에 다 안 나와도 됨 → 스크롤로 해결
- 뒤로가기는 항상 상단 왼쪽 ←

---

## 13. 에러/알림 문구 원칙

- 쉬운 말 사용 (전문 용어 금지)
- 존댓말 유지
- 짧고 명확하게
- 예: "중복된 약이 있어요. 확인해주세요." O
- 예: "Duplicate medication detected." X

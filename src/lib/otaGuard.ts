// OTA 자동 재시작(Updates.reloadAsync) 유예 — 타이핑 중인 화면을 지나서 껐다 켜지는 걸 막는다.
//
// 배경(2026-08-14, 오너 지적): App.tsx는 백그라운드 30초+ 후 포그라운드 복귀 시 새 OTA를
// 발견하면 곧바로 reloadAsync()를 부른다. 글쓰기 화면에서 타이핑하다가 잠깐 다른 앱을
// 봤다 돌아오면, 저장하지 않은 글이 화면 새로고침과 함께 통째로 날아간다.
//
// 화면들이 "지금은 안전하지 않다"고 등록해두면, App.tsx는 reloadAsync() 대신 이 모듈에
// 실행을 맡긴다 — 안전하면 즉시, 아니면 마지막 등록이 풀리는 순간(저장/취소/화면 이탈)에
// 1회 실행된다. 카운터가 아니라 Set인 이유는 여러 화면이 동시에 unsafe를 걸 수 있어서다
// (예: 글쓰기 화면 위에 사진 크게 보기가 겹쳐 열린 경우 등 — 실제로 그럴 일은 드물지만
// OverlayHost의 Set 방식과 같은 이유로 안전하게 겹쳐 쓸 수 있게 해둔다).

const unsafeOwners = new Set<string>();
let pendingReload: (() => void) | null = null;

export function markOtaUnsafe(ownerId: string): void {
  unsafeOwners.add(ownerId);
}

export function markOtaSafe(ownerId: string): void {
  unsafeOwners.delete(ownerId);
  if (unsafeOwners.size === 0 && pendingReload) {
    const run = pendingReload;
    pendingReload = null;
    run();
  }
}

export function isOtaSafeToReload(): boolean {
  return unsafeOwners.size === 0;
}

/** 지금 안전하면 즉시 실행하고, 아니면 다음에 안전해지는 순간(1회) 실행한다.
 *  이미 예약된 재시작이 있으면 최신 것으로 덮어쓴다(여러 번 부를 필요 없음 — 어차피
 *  reloadAsync 한 번이면 최신 번들이 전부 반영된다). */
export function runWhenOtaSafe(fn: () => void): void {
  if (isOtaSafeToReload()) {
    fn();
  } else {
    pendingReload = fn;
  }
}

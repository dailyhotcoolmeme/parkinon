import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppDialog, AppDialogButton, AppDialogButtonStyle } from '../components/common/AppDialog';
import { CenterToast } from '../components/common/CenterToast';

/* ------------------------------------------------------------------ *
 *  명령형 API 타입
 * ------------------------------------------------------------------ */

export interface AlertOptions {
  title?: string;
  message?: string;
  emoji?: string;
  confirmText?: string;
  /**
   * 단순 1버튼 알림을 OS 토스트처럼 가볍게 띄우고 싶을 때 true.
   * (title 없이 짧은 message만 있을 때 권장 — CenterToast로 강등)
   */
  toast?: boolean;
}

export interface ConfirmOptions {
  title?: string;
  message?: string;
  emoji?: string;
  confirmText?: string;
  cancelText?: string;
  /** true면 확인 버튼이 빨강(파괴적 액션)으로 표시 */
  destructive?: boolean;
  /** 배경탭/스와이프로 닫으면 false(=취소)로 resolve. 기본 true */
  cancelable?: boolean;
}

export interface ShowButton {
  /** resolve 시 반환될 식별자. 미지정 시 index 문자열 */
  id?: string;
  text: string;
  style?: AppDialogButtonStyle;
  icon?: string;
  /** opt-in 가로 배치. 연속된 row:true 버튼은 한 줄에 가로로 나란히 렌더된다. */
  row?: boolean;
}

export interface ShowOptions {
  title?: string;
  message?: string;
  emoji?: string;
  buttons: ShowButton[];
  cancelable?: boolean;
  animationType?: 'fade' | 'slide';
}

export interface DialogApi {
  /** 1버튼 알림. 확인 누르면(또는 토스트 종료 시) resolve */
  alert: (opts: AlertOptions) => Promise<void>;
  /** 확인/취소 2버튼. 확인=true, 취소/배경닫힘=false */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** 다중 선택지. 선택된 버튼의 id(없으면 index 문자열) resolve, 배경닫힘 시 null */
  show: (opts: ShowOptions) => Promise<string | null>;
}

/* ------------------------------------------------------------------ *
 *  내부 큐 항목
 * ------------------------------------------------------------------ */

type QueueItem =
  | {
      kind: 'dialog';
      emoji?: string;
      title?: string;
      message?: string;
      buttons: AppDialogButton[];
      cancelable: boolean;
      animationType: 'fade' | 'slide';
      /** 배경탭/스와이프/백버튼 시 처리 */
      onDismiss: () => void;
    }
  | {
      kind: 'toast';
      message: string;
      resolve: () => void;
    };

const DialogContext = createContext<DialogApi | null>(null);

const TOAST_DURATION = 1800;

/* ------------------------------------------------------------------ *
 *  Provider — 큐잉 단일 인스턴스 렌더
 * ------------------------------------------------------------------ */

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [visible, setVisible] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = queue[0] ?? null;

  // 현재 항목 종료 → 큐에서 제거 후 다음 항목 노출
  const advance = useCallback(() => {
    setVisible(false);
    // fade-out 시간 확보 후 다음 항목
    setTimeout(() => {
      setQueue((q) => q.slice(1));
      setVisible(true);
    }, 180);
  }, []);

  const enqueue = useCallback((item: QueueItem) => {
    setQueue((q) => {
      const next = [...q, item];
      return next;
    });
    setVisible(true);
  }, []);

  // 토스트 항목이 맨 앞에 오면 타이머로 자동 종료
  React.useEffect(() => {
    if (current?.kind === 'toast' && visible) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => {
        current.resolve();
        advance();
      }, TOAST_DURATION);
    }
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [current, visible, advance]);

  /* ----- 공개 API ----- */

  const alert = useCallback(
    (opts: AlertOptions): Promise<void> =>
      new Promise((resolve) => {
        // 단순 1버튼 + toast 옵션 → CenterToast로 강등
        if (opts.toast && opts.message && !opts.title) {
          enqueue({ kind: 'toast', message: opts.message, resolve });
          return;
        }
        const done = () => {
          resolve();
          advance();
        };
        enqueue({
          kind: 'dialog',
          emoji: opts.emoji,
          title: opts.title,
          message: opts.message,
          cancelable: true,
          animationType: 'fade',
          buttons: [
            {
              text: opts.confirmText ?? '확인',
              style: 'primary',
              onPress: done,
            },
          ],
          onDismiss: done,
        });
      }),
    [enqueue, advance],
  );

  const confirm = useCallback(
    (opts: ConfirmOptions): Promise<boolean> =>
      new Promise((resolve) => {
        const settle = (result: boolean) => {
          resolve(result);
          advance();
        };
        enqueue({
          kind: 'dialog',
          emoji: opts.emoji,
          title: opts.title,
          message: opts.message,
          cancelable: opts.cancelable ?? true,
          animationType: 'fade',
          // 60대 세로 스택: 확인 버튼이 위, 취소가 아래
          buttons: [
            {
              text: opts.confirmText ?? '확인',
              style: opts.destructive ? 'destructive' : 'primary',
              onPress: () => settle(true),
            },
            {
              text: opts.cancelText ?? '취소',
              style: 'cancel',
              onPress: () => settle(false),
            },
          ],
          onDismiss: () => settle(false),
        });
      }),
    [enqueue, advance],
  );

  const show = useCallback(
    (opts: ShowOptions): Promise<string | null> =>
      new Promise((resolve) => {
        const settle = (id: string | null) => {
          resolve(id);
          advance();
        };
        enqueue({
          kind: 'dialog',
          emoji: opts.emoji,
          title: opts.title,
          message: opts.message,
          cancelable: opts.cancelable ?? true,
          animationType: opts.animationType ?? 'fade',
          buttons: opts.buttons.map((b, i) => ({
            text: b.text,
            style: b.style,
            icon: b.icon,
            row: b.row,
            onPress: () => settle(b.id ?? String(i)),
          })),
          onDismiss: () => settle(null),
        });
      }),
    [enqueue, advance],
  );

  const api = useMemo<DialogApi>(
    () => ({ alert, confirm, show }),
    [alert, confirm, show],
  );

  return (
    <DialogContext.Provider value={api}>
      {children}
      {/* 앱 루트 1회 마운트되는 DialogHost (단일 인스턴스 + 큐잉) */}
      <DialogHost item={current} visible={visible} />
    </DialogContext.Provider>
  );
}

/* ------------------------------------------------------------------ *
 *  DialogHost — 단일 AppDialog / CenterToast 인스턴스 렌더
 * ------------------------------------------------------------------ */

function DialogHost({
  item,
  visible,
}: {
  item: QueueItem | null;
  visible: boolean;
}) {
  if (!item) return null;

  if (item.kind === 'toast') {
    return <CenterToast message={item.message} visible={visible} />;
  }

  return (
    <AppDialog
      visible={visible}
      emoji={item.emoji}
      title={item.title}
      message={item.message}
      buttons={item.buttons}
      cancelable={item.cancelable}
      animationType={item.animationType}
      onDismiss={item.onDismiss}
    />
  );
}

/* ------------------------------------------------------------------ *
 *  훅
 * ------------------------------------------------------------------ */

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error('useDialog must be used within a <DialogProvider>');
  }
  return ctx;
}

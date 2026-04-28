import { useState, useCallback, useRef } from 'react';

export function useToast() {
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToastMsg(message);
    setToastVisible(true);
    timerRef.current = setTimeout(() => setToastVisible(false), 1800);
  }, []);

  return { toastMsg, toastVisible, showToast };
}

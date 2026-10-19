import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Local text state that saves itself shortly after typing stops and on unmount/blur.
 * External changes are picked up when the field isn't being edited.
 */
export function useAutoField(value: string, save: (v: string) => Promise<unknown>, delay = 500) {
  const [text, setText] = useState(value);
  const latest = useRef(value);
  const saved = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editing = useRef(false);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!editing.current && value !== latest.current) {
      setText(value);
      latest.current = value;
      saved.current = value;
    }
  }, [value]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (latest.current !== saved.current) {
      const v = latest.current;
      saved.current = v;
      void saveRef.current(v);
    }
  }, []);

  useEffect(() => () => flush(), [flush]);

  const onChange = useCallback(
    (v: string) => {
      editing.current = true;
      latest.current = v;
      setText(v);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [delay, flush],
  );

  const onBlur = useCallback(() => {
    editing.current = false;
    flush();
  }, [flush]);

  return { text, onChange, onBlur, flush };
}

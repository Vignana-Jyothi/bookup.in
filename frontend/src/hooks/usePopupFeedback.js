import { useCallback, useRef, useState } from 'react';
import { useStore } from '../data/store';
import { ACTIONS } from '../data/actions';

/** Keeps operation state while announcing each new message through the global popup system. */
export function usePopupFeedback(initialValue = '', defaultType = 'error') {
  const { addToast, dispatch } = useStore();
  const [value, setValue] = useState(initialValue);
  const current = useRef(initialValue);
  const notificationId = useRef(null);
  const setFeedback = useCallback(update => {
    const next = typeof update === 'function' ? update(current.current) : update;
    current.current = next;
    setValue(next);
    if (notificationId.current) dispatch({ type: ACTIONS.REMOVE_TOAST, payload: notificationId.current });
    const message = typeof next === 'string' ? next : next?.text;
    notificationId.current = message ? addToast(message, next?.type || defaultType) : null;
  }, [addToast, defaultType, dispatch]);
  return [value, setFeedback];
}

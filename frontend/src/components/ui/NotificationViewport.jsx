import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../data/store';
import { ACTIONS } from '../../data/actions';
import { ToastNotification } from './Notifications.jsx';
import './NotificationViewport.css';

const variants = {
  success: { variant: 'success', title: 'Success' },
  error: { variant: 'alert', title: 'Action needed' },
  warning: { variant: 'warning', title: 'Please note' },
  info: { variant: 'info', title: 'Update' },
};

export default function NotificationViewport() {
  const { state, dispatch } = useStore();
  const dismiss = useCallback(id => dispatch({ type: ACTIONS.REMOVE_TOAST, payload: id }), [dispatch]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <section className="pn-toast-stack calup-notification-viewport" aria-label="Notifications">
      {state.toasts.map(notification => (
        <ToastNotification
          key={notification.id}
          {...(variants[notification.type] || variants.info)}
          message={notification.message}
          duration={notification.duration}
          onDismiss={() => dismiss(notification.id)}
        />
      ))}
    </section>, document.body,
  );
}

import { Navigate, useLocation } from 'react-router-dom';

export default function Support() {
  const location = useLocation();
  const ticketId = location.state?.ticketId;
  return <Navigate to="/dashboard" replace state={{ openSupport: true, supportTicketId: ticketId }} />;
}

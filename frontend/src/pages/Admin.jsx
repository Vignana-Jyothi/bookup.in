import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../data/store';
import { supabase } from '../services/supabase/supabaseClient';
import { isCalupAdmin, verifyAdminAccess } from '../services/supabase/adminMfa.js';
import AdminDashboard from './AdminDashboard.jsx';

export default function Admin() { return <AdminDashboard />; }

export function AdminRoute({ children }) {
  const auth = useAuth();
  const [access, setAccess] = useState(null);
  useEffect(() => {
    if (!isCalupAdmin(auth.user)) return undefined;
    let active = true;
    let pending = false;
    const check = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await verifyAdminAccess(supabase);
        if (active) setAccess({ userId: auth.user.id, allowed: result.user.id === auth.user.id });
      } catch {
        if (active) setAccess({ userId: auth.user.id, allowed: false });
      } finally { pending = false; }
    };
    check();
    const timer = setInterval(check, 60000);
    window.addEventListener('focus', check);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', check); };
  }, [auth.user]);
  if (auth.loading) return <div role="status">Checking administrator access...</div>;
  if (!auth.isAuthenticated) return <Navigate to="/login" replace />;
  if (!isCalupAdmin(auth.user)) return <Navigate to="/dashboard" replace />;
  if (access?.userId !== auth.user.id) return <div role="status">Checking SMS verification...</div>;
  if (!access.allowed) return <Navigate to="/login" replace />;
  return children;
}


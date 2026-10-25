import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../data/store';
import { merchantSchedulingService } from '../../services/booking/merchantSchedulingService';
import PillButton from '../ui/PillButton';
import { NotificationDialog } from '../ui/Notifications.jsx';

export default function InstructorPanel({ instructors, loading, error, onRetry, onChange }) {
  const { addToast } = useStore();
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  const save = async (operation, message) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const result = await operation();
      onChange(result.instructors || []);
      setNewName('');
      setEditing(null);
      setRemoving(null);
      addToast(message);
    } catch (err) {
      addToast(err.message || 'Could not update instructors.', 'error');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <aside className="card instructor-panel" aria-labelledby="instructors-heading" aria-busy={loading || busy}>
      <h3 id="instructors-heading">Instructors</h3>
      <p className="instructor-hint">You are the default instructor. Add team members who also deliver your services.</p>
      {loading && <p role="status">Loading instructors...</p>}
      {error && <button type="button" className="btn btn-secondary" onClick={onRetry} disabled={busy || loading}>Retry loading instructors</button>}
      {!loading && !error && !instructors.length && <p>No instructors found.</p>}
      <div className="instructor-list">
        {instructors.map(instructor => (
          <section className="instructor-item" key={instructor.id}>
            <div className="instructor-heading">
              <strong>{instructor.name}</strong>
              <span className="instructor-hint">{instructor.isOwner ? 'Merchant default' : instructor.active ? 'Active' : 'Removed'}</span>
            </div>
            {editing?.id === instructor.id ? (
              <form onSubmit={event => {
                event.preventDefault();
                const name = editing.name.trim();
                if (name.length >= 2) save(() => merchantSchedulingService.updateInstructor(instructor.id, { name }), 'Instructor updated');
              }}>
                <label className="form-label" htmlFor={`instructor-name-${instructor.id}`}>Instructor name</label>
                <input id={`instructor-name-${instructor.id}`} className="form-input" value={editing.name} minLength={2} maxLength={120} required autoFocus disabled={busy} onChange={event => setEditing({ ...editing, name: event.target.value })} />
                <div className="instructor-actions">
                  <PillButton type="submit" size="sm" disabled={busy || editing.name.trim().length < 2}>Save</PillButton>
                  <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </form>
            ) : (
              <div className="instructor-actions">
                <button type="button" className="btn btn-secondary" disabled={busy || loading} onClick={() => setEditing({ id: instructor.id, name: instructor.name })} aria-label={`Modify ${instructor.name}`}>Modify</button>
                {instructor.active && <Link to="/dashboard/availability">Availability</Link>}
                {!instructor.isOwner && (instructor.active ? (
                  <button type="button" className="btn btn-secondary" disabled={busy || loading} onClick={() => setRemoving(instructor)} aria-label={`Remove ${instructor.name}`}>Remove</button>
                ) : (
                  <button type="button" className="btn btn-secondary" disabled={busy || loading} onClick={() => save(() => merchantSchedulingService.updateInstructor(instructor.id, { active: true }), 'Instructor restored')}>Restore</button>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
      <form className="instructor-add" onSubmit={event => {
        event.preventDefault();
        const name = newName.trim();
        if (name.length >= 2) save(() => merchantSchedulingService.createInstructor(name), 'Instructor added');
      }}>
        <label className="form-label" htmlFor="new-instructor-name">Add instructor</label>
        <input id="new-instructor-name" className="form-input" placeholder="Team member name" value={newName} minLength={2} maxLength={120} required disabled={busy || loading || Boolean(error)} onChange={event => setNewName(event.target.value)} />
        <PillButton type="submit" variant="secondary" size="sm" disabled={busy || loading || Boolean(error) || newName.trim().length < 2}>{busy ? 'Saving...' : 'Add Instructor'}</PillButton>
      </form>
      <NotificationDialog
        open={Boolean(removing)}
        variant="warning"
        title={removing ? `Remove ${removing.name}?` : 'Remove instructor?'}
        message="This disables new bookings with this instructor. Existing appointments and records remain. Reassign their services to keep those services bookable. You can restore this instructor later."
        confirmLabel="Remove instructor"
        cancelLabel="Keep instructor"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing || removing.isOwner) throw new Error('The default instructor cannot be removed.');
          const result = await merchantSchedulingService.updateInstructor(removing.id, { active: false });
          onChange(result.instructors || []);
          addToast('Instructor removed. Reassign their services before accepting new bookings.');
        }}
      />
    </aside>
  );
}

import { useEffect, useState } from 'react';
import { getPasswordRequirements } from '../../services/supabase/passwordService.js';
import './PasswordStrength.css';

let estimatorPromise;
function loadEstimator() {
  estimatorPromise ||= import('../../utils/passwordStrength.js').catch(error => {
    estimatorPromise = undefined;
    throw error;
  });
  return estimatorPromise;
}

export default function PasswordStrength({ password, userInputs = [], id }) {
  const [estimate, setEstimate] = useState(null);
  const inputsKey = JSON.stringify(userInputs);
  useEffect(() => {
    let active = true;
    setEstimate(null);
    if (!password) return undefined;
    const timer = setTimeout(async () => {
      try {
        const { estimatePasswordStrength } = await loadEstimator();
        const next = estimatePasswordStrength(password, JSON.parse(inputsKey));
        if (active) setEstimate(next);
      } catch {
        if (active) setEstimate({ unavailable: true });
      }
    }, 150);
    return () => { active = false; clearTimeout(timer); };
  }, [password, inputsKey]);
  const level = estimate?.score === undefined ? 0 : Math.max(1, estimate.score);
  const label = ['Not rated', 'Weak', 'OK', 'Good', 'Strong'][level];
  return (
    <div className="password-strength" id={id} data-level={level}>
      <div className="password-strength-heading" aria-live="polite">
        <span>Password strength</span>
        <strong>{!password ? 'Enter a password' : estimate?.unavailable ? 'Unavailable' : !estimate ? 'Checking…' : label}</strong>
      </div>
      <div className="password-strength-bars" role="meter" aria-label="Estimated password strength" aria-valuemin={0} aria-valuemax={4} aria-valuenow={level} aria-valuetext={label}>
        {[1, 2, 3, 4].map(index => <span key={index} className={index <= level ? 'is-filled' : ''} />)}
      </div>
      <ul className="password-strength-requirements" aria-label="Password requirements">
        {getPasswordRequirements(password).map(requirement => (
          <li key={requirement.label} className={requirement.met ? 'is-met' : ''}>
            <span aria-hidden="true">{requirement.met ? '✓' : '○'}</span>
            <span className="setup-sr-only">{requirement.met ? 'Met: ' : 'Required: '}</span>{requirement.label}
          </li>
        ))}
      </ul>
      <p>{estimate?.suggestion || 'Strength is an estimate. Use a unique password and meet every requirement above.'}</p>
    </div>
  );
}

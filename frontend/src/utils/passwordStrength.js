import zxcvbn from 'zxcvbn';

/** Local guessability estimate. Return feedback only, never the library's password-bearing result. */
export function estimatePasswordStrength(password = '', userInputs = []) {
  if (!password) return null;
  const personalInputs = userInputs.filter(value => typeof value === 'string' && value.trim())
    .flatMap(value => {
      const localPart = value.split('@')[0];
      return [localPart, ...localPart.split(/[\s._-]+/)].filter(part => part.length >= 3);
    });
  // Bound work for exceptionally long pastes; this conservatively estimates the prefix.
  const result = zxcvbn(password.slice(0, 100), personalInputs);
  return {
    score: result.score,
    suggestion: result.feedback.warning || result.feedback.suggestions[0] || '',
  };
}

import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import BlueFlame from '../components/BlueFlame.jsx';
import './Login.css';

const ERRORS = {
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/invalid-email': 'That email address looks invalid.',
  'auth/email-already-in-use': 'An account with that email already exists.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Try again shortly.',
  'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
};
const friendlyError = (code) => ERRORS[code] || 'Something went wrong. Please try again.';

export default function Login() {
  const { user, loginWithGoogle, loginWithEmail, signUpWithEmail, resetPassword } = useAuth();
  const navigate = useNavigate();
  const from = useLocation().state?.from || '/';
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={from} replace />;

  const isLogin = mode === 'login';

  const run = async (fn) => {
    setError('');
    setInfo('');
    setBusy(true);
    try {
      await fn();
      navigate(from, { replace: true });
    } catch (e) {
      setError(friendlyError(e.code));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    run(() => (isLogin ? loginWithEmail(email, password) : signUpWithEmail(email, password, name)));
  };

  const onReset = async () => {
    if (!email) return setError('Enter your email above, then click "Forgot password?".');
    setError('');
    try {
      await resetPassword(email);
      setInfo('Password reset email sent.');
    } catch (e) {
      setError(friendlyError(e.code));
    }
  };

  const switchMode = () => {
    setMode(isLogin ? 'signup' : 'login');
    setError('');
    setInfo('');
  };

  return (
    <div className="login-page">
      <BlueFlame />
      <div className="login-card">
        <h1 className="logo">AES <span>STRIKERS</span></h1>
        <p className="tagline">{isLogin ? 'Ignite your deck' : 'Forge your legend'}</p>

        <button className="btn btn-google" onClick={() => run(loginWithGoogle)} disabled={busy}>
          <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
            <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z" />
          </svg>
          Continue with Google
        </button>

        <div className="divider"><span>or</span></div>

        <form onSubmit={onSubmit}>
          {!isLogin && (
            <input type="text" placeholder="Player name" value={name}
              onChange={(e) => setName(e.target.value)} required autoComplete="nickname" />
          )}
          <input type="email" placeholder="Email" value={email}
            onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          <input type="password" placeholder="Password" value={password}
            onChange={(e) => setPassword(e.target.value)} required minLength={6}
            autoComplete={isLogin ? 'current-password' : 'new-password'} />

          {isLogin && (
            <button type="button" className="link small" onClick={onReset}>Forgot password?</button>
          )}

          {error && <p className="msg error" role="alert">{error}</p>}
          {info && <p className="msg info">{info}</p>}

          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Igniting…' : isLogin ? 'Log In' : 'Create Account'}
          </button>
        </form>

        <p className="switch">
          {isLogin ? 'New here?' : 'Already have an account?'}{' '}
          <button className="link" onClick={switchMode}>
            {isLogin ? 'Create an account' : 'Log in'}
          </button>
        </p>
      </div>
    </div>
  );
}

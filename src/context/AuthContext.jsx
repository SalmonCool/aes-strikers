import { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  signOut,
} from 'firebase/auth';
import { auth } from '../firebase/config.js';
import { saveUserProfile } from '../firebase/db.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(auth));
  const [, setNameVersion] = useState(0);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) saveUserProfile(u).catch((e) => console.error('Failed to save profile', e));
    });
  }, []);

  const value = {
    user,
    loading,
    loginWithGoogle: () => signInWithPopup(auth, new GoogleAuthProvider()),
    loginWithEmail: (email, password) => signInWithEmailAndPassword(auth, email, password),
    signUpWithEmail: async (email, password, displayName) => {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName) {
        await updateProfile(cred.user, { displayName });
        await saveUserProfile(cred.user); // re-save now that the name is set
      }
      return cred;
    },
    resetPassword: (email) => sendPasswordResetEmail(auth, email),
    // Changes the signed-in player's display name (sign-in account + public profile).
    updateDisplayName: async (displayName) => {
      await updateProfile(auth.currentUser, { displayName });
      await saveUserProfile(auth.currentUser);
      setNameVersion((v) => v + 1); // Firebase updates the user object in place, so re-render consumers
    },
    logout: () => signOut(auth),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

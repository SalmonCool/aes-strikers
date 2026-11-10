import { isFirebaseConfigured } from '../firebase/config.js';

export default function Home() {
  return (
    <main className="home">
      <h1>AES Strikers</h1>
      <p>Firebase: {isFirebaseConfigured ? 'connected' : 'not configured'}</p>
    </main>
  );
}

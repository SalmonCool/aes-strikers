import { useAuth } from '../context/AuthContext.jsx';

export default function Home() {
  const { user, logout } = useAuth();
  return (
    <main className="home">
      <h1>AES STRIKERS</h1>
      <p>Welcome, {user.displayName || user.email}</p>
      <button onClick={logout}>Log out</button>
    </main>
  );
}

import { Routes, Route, Navigate } from 'react-router-dom';
import DeckManager from './pages/DeckManager.jsx';
import Friends from './pages/Friends.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import GameBoard from './pages/GameBoard.jsx';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
        <Route path="/play/:sessionId" element={<ProtectedRoute><GameBoard /></ProtectedRoute>} />
        <Route path="/deck" element={<ProtectedRoute><DeckManager /></ProtectedRoute>} />
        <Route path="/friends" element={<ProtectedRoute><Friends /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

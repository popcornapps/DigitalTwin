import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import AuthGate from './components/AuthGate.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </AuthProvider>
  </React.StrictMode>
);

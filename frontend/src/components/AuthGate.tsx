import type { ReactNode } from 'react';
import { Activity, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import loginBackground from '../assets/login-background.png';

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

function BrandingPanel() {
  return (
    <div className="hidden lg:flex flex-1 relative flex-col justify-center px-16 py-14 text-white">
      <h2 className="text-6xl font-extrabold tracking-tight leading-tight">
        Intelligent Insights.<br />
        <span className="text-blue-300">Smarter Decisions.</span>
      </h2>
      <p className="text-blue-100/90 text-lg max-w-lg mt-5 leading-relaxed">
        PharmaTwin is your digital twin platform for real-time process monitoring,
        KPI prediction, and deviation intelligence.
      </p>
    </div>
  );
}

function LoginScreen() {
  return (
    <div
      className="relative min-h-screen w-screen flex bg-cover bg-center"
      style={{ backgroundImage: `url(${loginBackground})` }}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950/70 via-slate-900/30 to-transparent" />

      <BrandingPanel />

      <div className="relative flex-1 flex items-center justify-center px-6 py-14">
        <div className="w-full max-w-md bg-white/95 backdrop-blur rounded-2xl shadow-2xl border border-white/60 px-12 py-14 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg">
            <Activity className="text-white" size={28} />
          </div>

          <h1 className="text-3xl font-bold text-gray-900 tracking-tight leading-snug mt-6">
            Welcome to <span className="text-blue-600">PharmaTwin</span>
          </h1>
          <p className="text-base text-gray-500 mt-3 leading-relaxed">Please sign-in with your Microsoft 365 account to continue.</p>

          <div className="flex items-center justify-center gap-3 my-8">
            <div className="h-px flex-1 bg-gray-200" />
            <div className="w-7 h-7 rounded-full border border-blue-200 flex items-center justify-center shrink-0">
              <Lock className="text-blue-600" size={14} />
            </div>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          <button
            onClick={() => { window.location.href = '/api/auth/login'; }}
            className="w-full flex items-center justify-center gap-3 bg-white text-gray-900 border border-blue-200 px-4 py-3.5 rounded-xl text-base font-bold shadow-md hover:bg-blue-50/50 hover:border-blue-300 transition-colors"
          >
            <MicrosoftLogo />
            Sign-In with Microsoft
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === 'loading') return null;
  if (status === 'unauthed') return <LoginScreen />;
  return <>{children}</>;
}

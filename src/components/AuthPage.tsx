import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Sun, Moon, ShieldCheck, Sparkles, Lock } from 'lucide-react';

interface AuthPageProps {
  onAuthSuccess: () => void;
}

type Feedback = { type: 'error' | 'success'; text: string } | null;

export default function AuthPage({ onAuthSuccess }: AuthPageProps) {
  const { signIn, signUp } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setLoading(true);

    try {
      if (isLogin) {
        await signIn(email, password);
        onAuthSuccess();
        return;
      }

      await signUp(email, password);
      setFeedback({
        type: 'success',
        text: 'Account created! Please check your email to confirm your account, then log in.',
      });
      setIsLogin(true);
    } catch (err: any) {
      let errorMessage = err.message || 'An error occurred';

      if (errorMessage.toLowerCase().includes('invalid') && errorMessage.toLowerCase().includes('email')) {
        const blockedDomains = ['example.com', 'test.com', 'example.org', 'localhost'];
        const emailDomain = email.split('@')[1]?.toLowerCase();

        if (emailDomain && blockedDomains.includes(emailDomain)) {
          errorMessage = `Email validation failed: "${emailDomain}" is a reserved test domain and cannot be used. Please use a real email address (e.g., Gmail, Outlook, Yahoo, or your personal domain).`;
        } else {
          errorMessage = `Email validation failed: "${email}" is not accepted. Please use a valid email address from a real domain (e.g., Gmail, Outlook, Yahoo).`;
        }
      }

      setFeedback({ type: 'error', text: errorMessage });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 text-slate-50">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-10 -top-20 h-72 w-72 rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute bottom-10 right-0 h-80 w-80 rounded-full bg-purple-600/20 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_#ffffff0a,_transparent_35%)]" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-10 flex items center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-500 shadow-lg shadow-blue-500/30">
              <Lock className="text-white" size={24} />
            </div>
            <div>
              <p className="text-sm uppercase tracking-[0.18em] text-slate-300">Vocabulary Learning</p>
              <h1 className="text-2xl font-semibold text-white">English ↔ Georgian</h1>
            </div>
          </div>

          <button
            onClick={toggleTheme}
            className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-slate-50 backdrop-blur-xl ring-1 ring-white/20 transition-all hover:-translate-y-0.5 hover:bg-white/20"
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            type="button"
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            <span>{theme === 'light' ? 'Dark' : 'Light'} mode</span>
          </button>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr] items-stretch">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 p-8 text-white shadow-2xl shadow-blue-800/40 ring-1 ring-white/10">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,_rgba(255,255,255,0.2),_transparent_35%)]" />
            <div className="relative z-10 space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-medium backdrop-blur">
                <Sparkles size={16} />
                <span>Modern learning workspace</span>
              </div>
              <h2 className="text-3xl font-semibold leading-tight sm:text-4xl">
                Level up your vocabulary with a refreshed, focused sign-in experience.
              </h2>
              <p className="max-w-xl text-lg text-indigo-100/90">
                Manage words, practice freely, and track your progress with a secure account. Switch between light and dark modes anytime.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {["Secure Supabase auth", "Progress insights", "Flashcard & test modes", "Personalized themes"].map((item) => (
                  <div key={item} className="flex items-center gap-3 rounded-2xl bg-white/10 p-3 text-sm font-medium shadow-lg shadow-black/10">
                    <ShieldCheck size={18} className="text-emerald-200" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="relative rounded-3xl bg-white/90 p-8 shadow-2xl shadow-slate-900/30 backdrop-blur-xl ring-1 ring-slate-200/70 transition-all duration-200 dark:bg-slate-900/80 dark:ring-slate-800/70">
            <div className="mb-8 space-y-2 text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-blue-600 dark:text-blue-300">
                {isLogin ? 'Welcome back' : 'Create account'}
              </p>
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white">{isLogin ? 'Access your workspace' : 'Join the community'}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {isLogin ? 'Sign in to continue learning and tracking your progress.' : 'Start saving words, practicing, and testing your knowledge.'}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  placeholder="you@example.com"
                  autoComplete="email"
                />
                {!isLogin && (
                  <p className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-slate-700 dark:border-blue-900/60 dark:bg-blue-900/20 dark:text-slate-200">
                    Use a real email address (Gmail, Outlook, etc.). Test domains like example.com are not accepted.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  placeholder="••••••••"
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                />
              </div>

              {feedback && (
                <div
                  className={`rounded-2xl border px-4 py-3 text-sm font-medium transition-all ${
                    feedback.type === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 shadow-md shadow-emerald-500/10 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200'
                      : 'border-rose-200 bg-rose-50 text-rose-800 shadow-md shadow-rose-500/10 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-200'
                  }`}
                  role={feedback.type === 'error' ? 'alert' : 'status'}
                >
                  {feedback.text}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="relative w-full overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 px-4 py-3 text-base font-semibold text-white shadow-lg shadow-blue-600/30 transition hover:scale-[1.01] hover:shadow-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="relative z-10">{loading ? 'Please wait...' : isLogin ? 'Sign in securely' : 'Create account'}</span>
                <span className="absolute inset-0 bg-gradient-to-r from-white/10 via-white/0 to-white/10 opacity-0 transition-opacity duration-300 hover:opacity-100" />
              </button>
            </form>

            <div className="mt-8 text-center text-sm text-slate-600 dark:text-slate-400">
              {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
              <button
                onClick={() => {
                  setIsLogin(!isLogin);
                  setFeedback(null);
                }}
                className="font-semibold text-blue-600 underline-offset-4 transition hover:underline dark:text-blue-300"
                type="button"
              >
                {isLogin ? 'Create one' : 'Sign in instead'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

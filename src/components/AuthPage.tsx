import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Sun, Moon } from 'lucide-react';

interface AuthPageProps {
  onAuthSuccess: () => void;
}

export default function AuthPage({ onAuthSuccess }: AuthPageProps) {
  const { signIn, signUp } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await signIn(email, password);
      } else {
        await signUp(email, password);
        if (!isLogin) {
          setError('Account created! Please check your email to confirm your account, then log in.');
          setIsLogin(true);
          setLoading(false);
          return;
        }
      }
      onAuthSuccess();
    } catch (err: any) {
      let errorMessage = err.message || 'An error occurred';
      
      // Provide helpful guidance for email validation errors
      if (errorMessage.includes('invalid') && errorMessage.toLowerCase().includes('email')) {
        const blockedDomains = ['example.com', 'test.com', 'example.org', 'localhost'];
        const emailDomain = email.split('@')[1]?.toLowerCase();
        
        if (blockedDomains.includes(emailDomain)) {
          errorMessage = `Email validation failed: "${emailDomain}" is a reserved test domain and cannot be used. Please use a real email address (e.g., Gmail, Outlook, Yahoo, or your personal domain).`;
        } else {
          errorMessage = `Email validation failed: "${email}" is not accepted. Please use a valid email address from a real domain (e.g., Gmail, Outlook, Yahoo).`;
        }
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-purple-900/20 flex items-center justify-center p-4 transition-colors">
      {/* Theme Toggle */}
      <button
        onClick={toggleTheme}
        className="absolute top-4 right-4 p-3 rounded-2xl bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl shadow-xl border border-white/20 dark:border-gray-700/20 text-gray-600 dark:text-gray-300 hover:bg-white/90 dark:hover:bg-gray-700/80 transition-all duration-200 transform hover:scale-105"
        title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      >
        {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
      </button>
      
      <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-8 w-full max-w-md transition-all duration-300">
        <div className="text-center mb-8">
          <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
            English-Georgian Vocabulary
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            {isLogin ? 'Sign in to continue learning' : 'Create your account'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 bg-white/50 dark:bg-gray-700/50 backdrop-blur-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 transition-all duration-200"
              placeholder="your@gmail.com"
            />
            {!isLogin && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-xl p-3 border border-blue-200 dark:border-blue-800">
                Use a real email address (Gmail, Outlook, etc.). Test domains like example.com are not accepted.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 bg-white/50 dark:bg-gray-700/50 backdrop-blur-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 transition-all duration-200"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className={`p-4 rounded-2xl border-2 transition-all duration-300 ${
              error.includes('created') 
                ? 'bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 text-green-800 dark:text-green-300 border-green-200 dark:border-green-800 shadow-lg shadow-green-500/10' 
                : 'bg-gradient-to-r from-red-50 to-pink-50 dark:from-red-900/20 dark:to-pink-900/20 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800 shadow-lg shadow-red-500/10'
            }`}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-4 rounded-2xl font-bold text-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl"
          >
            {loading ? 'Please wait...' : isLogin ? 'Sign In' : 'Sign Up'}
          </button>
        </form>

        <div className="mt-8 text-center">
          <button
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
            }}
            className="text-blue-600 dark:text-blue-400 hover:text-purple-600 dark:hover:text-purple-400 font-semibold transition-all duration-200 hover:underline"
          >
            {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}

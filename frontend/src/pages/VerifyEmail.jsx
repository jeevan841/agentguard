import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Shield, Mail, CheckCircle, XCircle, Loader2, RefreshCw } from 'lucide-react';
import { authAPI } from '../api/client';
import toast from 'react-hot-toast';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  const email = searchParams.get('email') || '';

  const [status, setStatus] = useState(token ? 'verifying' : 'waiting');
  const [resending, setResending] = useState(false);
  const [resendEmail, setResendEmail] = useState(email);

  useEffect(() => {
    if (!token) return;
    authAPI.verifyEmail(token)
      .then(() => setStatus('success'))
      .catch(() => setStatus('error'));
  }, [token]);

  const handleResend = async (e) => {
    e.preventDefault();
    if (!resendEmail) return;
    setResending(true);
    try {
      await authAPI.resendVerification(resendEmail);
      toast.success('Verification email sent! Check your inbox.');
    } catch {
      toast.error('Failed to resend. Please try again.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/3 w-64 h-64 bg-accent/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-slide-up text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-500 shadow-glow-md mb-4">
          <Shield size={28} className="text-white" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-1">AgentGuard</h1>
        <p className="text-gray-400 text-sm mb-8">AI Governance & Security Platform</p>

        <div className="glass-card p-8">
          {status === 'verifying' && (
            <div className="space-y-4">
              <div className="w-16 h-16 bg-brand-500/20 rounded-full flex items-center justify-center mx-auto">
                <Loader2 size={32} className="text-brand-400 animate-spin" />
              </div>
              <h2 className="text-xl font-bold text-white">Verifying your email...</h2>
              <p className="text-gray-400 text-sm">Please wait a moment.</p>
            </div>
          )}

          {status === 'success' && (
            <div className="space-y-4">
              <div className="w-16 h-16 bg-success/20 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle size={32} className="text-success" />
              </div>
              <h2 className="text-xl font-bold text-white">Email Verified!</h2>
              <p className="text-gray-400 text-sm">Your account is now active. You can sign in to the platform.</p>
              <button onClick={() => navigate('/login')} className="btn-primary w-full justify-center py-2.5 mt-2">
                Sign In to AgentGuard
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-4">
              <div className="w-16 h-16 bg-danger/20 rounded-full flex items-center justify-center mx-auto">
                <XCircle size={32} className="text-danger" />
              </div>
              <h2 className="text-xl font-bold text-white">Link Expired</h2>
              <p className="text-gray-400 text-sm">This verification link has expired or is invalid.</p>
              <form onSubmit={handleResend} className="space-y-3 text-left">
                <input type="email" value={resendEmail} onChange={(e) => setResendEmail(e.target.value)}
                  className="input-field" placeholder="your@email.com" required />
                <button type="submit" disabled={resending} className="btn-primary w-full justify-center py-2.5">
                  {resending ? <><RefreshCw size={14} className="animate-spin" /> Sending...</> : 'Resend Verification Email'}
                </button>
              </form>
            </div>
          )}

          {status === 'waiting' && (
            <div className="space-y-5">
              <div className="w-16 h-16 bg-brand-500/20 rounded-full flex items-center justify-center mx-auto relative">
                <Mail size={30} className="text-brand-400" />
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-warning rounded-full flex items-center justify-center text-xs font-bold text-white">1</span>
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Check Your Email</h2>
                <p className="text-gray-400 text-sm mt-2 leading-relaxed">
                  We sent a verification link to{' '}
                  {email ? <span className="text-brand-300 font-medium">{email}</span> : 'your email address.'}{' '}
                  Click the link to activate your account.
                </p>
              </div>
              <div className="p-3 bg-surface-2 rounded-lg text-xs text-gray-400">
                <strong className="text-gray-300">💡 Testing locally?</strong> Check Mailpit at{' '}
                <a href="http://localhost:8025" target="_blank" rel="noopener noreferrer"
                  className="text-brand-400 hover:text-brand-300 underline font-mono">localhost:8025</a>
              </div>
              <div className="border-t border-white/5 pt-4">
                <p className="text-xs text-gray-500 mb-3">Didn't receive it?</p>
                <form onSubmit={handleResend} className="flex gap-2">
                  <input type="email" value={resendEmail} onChange={(e) => setResendEmail(e.target.value)}
                    className="input-field flex-1 text-sm" placeholder="your@email.com" required />
                  <button type="submit" disabled={resending} className="btn-secondary whitespace-nowrap">
                    {resending ? <RefreshCw size={14} className="animate-spin" /> : 'Resend'}
                  </button>
                </form>
              </div>
              <Link to="/login" className="block text-center text-xs text-gray-500 hover:text-gray-300 transition-colors">
                ← Back to Sign In
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Shield, Eye, EyeOff, Loader2, Mail, Smartphone, ChevronRight, RefreshCw } from 'lucide-react';
import { authAPI } from '../api/client';
import { useAuthStore } from '../store';
import toast from 'react-hot-toast';

// Step progress indicator
function StepIndicator({ current, total }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
            i + 1 < current ? 'bg-success text-white' :
            i + 1 === current ? 'bg-brand-500 text-white shadow-glow-sm' :
            'bg-surface-4 text-gray-500'
          }`}>
            {i + 1 < current ? '✓' : i + 1}
          </div>
          {i < total - 1 && (
            <div className={`h-0.5 w-8 rounded-full transition-all duration-300 ${i + 1 < current ? 'bg-success' : 'bg-surface-4'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function LoginPage() {
  const [mode, setMode] = useState('login'); // 'login' | 'register'

  // Step 1 — credentials
  const [email, setEmail] = useState('admin@agentguard.io');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // MFA state
  const [step, setStep] = useState(1);           // 1 | 2 | 3
  const [totalSteps, setTotalSteps] = useState(1);
  const [tempToken, setTempToken] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [resending, setResending] = useState(false);

  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  // ── Step 1: Password ────────────────────────────────────────────────────────
  const handleCredentials = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'register') {
        const res = await authAPI.register(email, password, name);
        toast.success('Account created! Please check your email to verify your account.');
        navigate(`/verify-email?email=${encodeURIComponent(email)}`);
        return;
      }

      const res = await authAPI.login(email, password);

      if (res.data.mfa_required) {
        // Determine how many total steps this user has
        const nextStep = res.data.next_step; // 'email_otp'
        // We'll know total steps after email OTP (could be 2 or 3)
        setTempToken(res.data.temp_token);
        setStep(2);
        setTotalSteps(2); // optimistic, will update after email OTP
        toast.success('Login code sent to your email!');
      } else {
        login(res.data.user, res.data.token);
        toast.success(`Welcome back${res.data.user.name ? ', ' + res.data.user.name : ''}!`);
        navigate('/dashboard');
      }
    } catch (err) {
      const data = err.response?.data;
      if (data?.email_verification_required) {
        toast.error('Please verify your email before logging in.');
        navigate(`/verify-email?email=${encodeURIComponent(email)}`);
      } else {
        toast.error(data?.message || 'Authentication failed');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: Email OTP ────────────────────────────────────────────────────────
  const handleEmailOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await authAPI.verifyEmailOtp(tempToken, emailOtp);

      if (res.data.mfa_required && res.data.next_step === 'totp') {
        setTempToken(res.data.temp_token);
        setStep(3);
        setTotalSteps(3);
        toast.success('Email verified! Enter your authenticator code.');
      } else {
        login(res.data.user, res.data.token);
        toast.success(`Welcome back${res.data.user.name ? ', ' + res.data.user.name : ''}!`);
        navigate('/dashboard');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 3: TOTP ─────────────────────────────────────────────────────────────
  const handleTotp = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await authAPI.verifyTotp(tempToken, totpCode);
      login(res.data.user, res.data.token);
      toast.success(`Welcome back${res.data.user.name ? ', ' + res.data.user.name : ''}!`);
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid authenticator code');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setResending(true);
    try {
      await authAPI.login(email, password);
      toast.success('A new code has been sent to your email.');
    } catch {
      toast.error('Failed to resend code');
    } finally {
      setResending(false);
    }
  };

  const stepLabels = ['Credentials', 'Email Code', 'Authenticator'];

  return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background blobs */}
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/3 w-64 h-64 bg-accent/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-slide-up">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-500 shadow-glow-md mb-4">
            <Shield size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">AgentGuard</h1>
          <p className="text-gray-400 text-sm mt-1">AI Governance & Security Platform</p>
        </div>

        <div className="glass-card p-8">
          {/* Mode Toggle — only show on step 1 */}
          {step === 1 && (
            <div className="flex gap-1 p-1 bg-surface-2 rounded-lg mb-6">
              {['login', 'register'].map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all duration-150 ${
                    mode === m ? 'bg-brand-500 text-white shadow-glow-sm' : 'text-gray-400 hover:text-white'
                  }`}>
                  {m === 'login' ? 'Sign In' : 'Register'}
                </button>
              ))}
            </div>
          )}

          {/* Step Progress Indicator (MFA steps) */}
          {step > 1 && <StepIndicator current={step} total={totalSteps} />}

          {/* ── Step 1: Credentials ── */}
          {step === 1 && (
            <form onSubmit={handleCredentials} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Full Name</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                    className="input-field" placeholder="John Doe" />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="input-field" placeholder="admin@agentguard.io" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Password</label>
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-field pr-10" placeholder="••••••••" required />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5 mt-2">
                {loading ? <><Loader2 size={16} className="animate-spin" /> {mode === 'login' ? 'Signing in...' : 'Creating account...'}</> 
                         : <>{mode === 'login' ? 'Sign In' : 'Create Account'} <ChevronRight size={14} /></>}
              </button>
            </form>
          )}

          {/* ── Step 2: Email OTP ── */}
          {step === 2 && (
            <form onSubmit={handleEmailOtp} className="space-y-4">
              <div className="text-center mb-4">
                <div className="w-12 h-12 bg-brand-500/20 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <Mail size={22} className="text-brand-400" />
                </div>
                <h3 className="font-semibold text-white">Check your email</h3>
                <p className="text-sm text-gray-400 mt-1">
                  We sent a 6-digit code to <span className="text-brand-300 font-medium">{email}</span>
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">One-Time Code</label>
                <input
                  type="text" inputMode="numeric" maxLength={6}
                  value={emailOtp} onChange={(e) => setEmailOtp(e.target.value.replace(/\D/g, ''))}
                  className="input-field text-center text-2xl font-mono tracking-[0.5em]"
                  placeholder="000000" required autoFocus
                />
              </div>
              <button type="submit" disabled={loading || emailOtp.length < 6} className="btn-primary w-full justify-center py-2.5">
                {loading ? <><Loader2 size={16} className="animate-spin" /> Verifying...</> : <>Verify Code <ChevronRight size={14} /></>}
              </button>
              <button type="button" onClick={handleResendOtp} disabled={resending}
                className="btn-ghost w-full justify-center text-xs text-gray-500 hover:text-gray-300">
                {resending ? <><RefreshCw size={12} className="animate-spin" /> Sending...</> : "Didn't receive it? Resend code"}
              </button>
            </form>
          )}

          {/* ── Step 3: TOTP ── */}
          {step === 3 && (
            <form onSubmit={handleTotp} className="space-y-4">
              <div className="text-center mb-4">
                <div className="w-12 h-12 bg-brand-500/20 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <Smartphone size={22} className="text-brand-400" />
                </div>
                <h3 className="font-semibold text-white">Authenticator App</h3>
                <p className="text-sm text-gray-400 mt-1">Enter the 6-digit code from Google Authenticator or Authy</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Authenticator Code</label>
                <input
                  type="text" inputMode="numeric" maxLength={6}
                  value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  className="input-field text-center text-2xl font-mono tracking-[0.5em]"
                  placeholder="000000" required autoFocus
                />
              </div>
              <button type="submit" disabled={loading || totpCode.length < 6} className="btn-primary w-full justify-center py-2.5">
                {loading ? <><Loader2 size={16} className="animate-spin" /> Verifying...</> : <>Complete Sign In <ChevronRight size={14} /></>}
              </button>
            </form>
          )}

          {step === 1 && mode === 'login' && (
            <div className="mt-6 p-3 bg-surface-2 rounded-lg">
              <p className="text-xs text-gray-500 text-center">Demo credentials prefilled — just click Sign In</p>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">AgentGuard v1.0 · Enterprise AI Security</p>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { X, Smartphone, Copy, CheckCircle, Loader2, RefreshCw } from 'lucide-react';
import { authAPI } from '../api/client';
import { useAuthStore } from '../store';
import toast from 'react-hot-toast';

export default function TotpSetupModal({ onClose, onSuccess }) {
  const [step, setStep] = useState('loading'); // 'loading' | 'scan' | 'confirm' | 'done'
  const [qrCode, setQrCode] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const { user, setUser } = useAuthStore();

  // Kick off setup on mount
  useState(() => {
    authAPI.setupTotp()
      .then((res) => { setQrCode(res.data.qr_code); setStep('scan'); })
      .catch(() => { toast.error('Failed to generate QR code'); onClose(); });
  });

  const handleConfirm = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authAPI.confirmTotp(code);
      setStep('done');
      toast.success('Authenticator app enabled!');
      if (onSuccess) onSuccess();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-card w-full max-w-md p-6 animate-slide-up">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-brand-500/20 rounded-lg flex items-center justify-center">
              <Smartphone size={16} className="text-brand-400" />
            </div>
            <h3 className="font-semibold text-white">Set Up Authenticator App</h3>
          </div>
          <button onClick={onClose} className="btn-ghost text-gray-400"><X size={16} /></button>
        </div>

        {step === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 size={28} className="animate-spin text-brand-400" />
            <p className="text-gray-400 text-sm">Generating QR code...</p>
          </div>
        )}

        {step === 'scan' && (
          <div className="space-y-4">
            <div className="p-3 bg-surface-2 rounded-lg text-xs text-gray-400 leading-relaxed">
              <strong className="text-gray-200">Step 1:</strong> Open Google Authenticator or Authy and scan the QR code below.
            </div>
            {qrCode && (
              <div className="flex justify-center p-4 bg-white rounded-xl">
                <img src={qrCode} alt="TOTP QR Code" className="w-48 h-48" />
              </div>
            )}
            <button onClick={() => setStep('confirm')} className="btn-primary w-full justify-center">
              I've scanned it — Continue
            </button>
          </div>
        )}

        {step === 'confirm' && (
          <form onSubmit={handleConfirm} className="space-y-4">
            <div className="p-3 bg-surface-2 rounded-lg text-xs text-gray-400">
              <strong className="text-gray-200">Step 2:</strong> Enter the 6-digit code shown in your authenticator app to confirm the setup.
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Verification Code</label>
              <input
                type="text" inputMode="numeric" maxLength={6}
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="input-field text-center text-2xl font-mono tracking-[0.5em]"
                placeholder="000000" required autoFocus
              />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setStep('scan')} className="btn-secondary flex-1 justify-center">
                Back
              </button>
              <button type="submit" disabled={loading || code.length < 6} className="btn-primary flex-1 justify-center">
                {loading ? <Loader2 size={14} className="animate-spin" /> : 'Confirm & Enable'}
              </button>
            </div>
          </form>
        )}

        {step === 'done' && (
          <div className="text-center space-y-4 py-4">
            <div className="w-14 h-14 bg-success/20 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle size={28} className="text-success" />
            </div>
            <h4 className="font-bold text-white">Authenticator Enabled!</h4>
            <p className="text-sm text-gray-400">Your account now requires a TOTP code at every login.</p>
            <button onClick={onClose} className="btn-primary w-full justify-center">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

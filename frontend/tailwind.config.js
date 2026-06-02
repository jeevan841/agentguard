/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Primary brand colors
        brand: {
          50: '#f0f0ff',
          100: '#e4e2ff',
          200: '#ccc8ff',
          300: '#ada4ff',
          400: '#8b76ff',
          500: '#7c3aed',
          600: '#6d28d9',
          700: '#5b21b6',
          800: '#4c1d95',
          900: '#3b0764',
        },
        // Background layers
        surface: {
          0: '#050914',
          1: '#080e1a',
          2: '#0d1420',
          3: '#111827',
          4: '#1a2234',
          5: '#1f2937',
        },
        // Accent cyan
        accent: {
          DEFAULT: '#06b6d4',
          light: '#22d3ee',
          dark: '#0891b2',
        },
        // Status colors
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#f43f5e',
        info: '#3b82f6',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'hero-glow': 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(124, 58, 237, 0.3), transparent)',
        'card-gradient': 'linear-gradient(135deg, rgba(17,24,39,0.8) 0%, rgba(31,41,55,0.8) 100%)',
      },
      boxShadow: {
        'glow-sm': '0 0 10px rgba(124, 58, 237, 0.3)',
        'glow-md': '0 0 25px rgba(124, 58, 237, 0.4)',
        'glow-cyan': '0 0 25px rgba(6, 182, 212, 0.3)',
        'glow-green': '0 0 25px rgba(16, 185, 129, 0.3)',
        'glow-red': '0 0 25px rgba(244, 63, 94, 0.3)',
        'card': '0 4px 24px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.2)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'slide-in': 'slideIn 0.3s ease-out',
      },
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: { from: { opacity: 0, transform: 'translateY(16px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        slideIn: { from: { opacity: 0, transform: 'translateX(-16px)' }, to: { opacity: 1, transform: 'translateX(0)' } },
      },
      backdropBlur: { xs: '2px' },
    },
  },
  plugins: [],
}

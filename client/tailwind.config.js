/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          900: 'var(--es-text-primary)',
          800: 'var(--es-text-primary)',
          700: 'var(--es-text-secondary)',
          600: 'var(--es-text-muted)',
        },
        primary: {
          DEFAULT: 'var(--es-primary)',
          hover: 'var(--es-primary-hover)',
          light: 'var(--es-primary-soft)',
          dark: 'var(--es-navy-800)',
        },
        gold: {
          DEFAULT: '#D7A940',
          hover: '#BF922E',
          light: '#FEF9EC',
        },
        academicGreen: {
          DEFAULT: '#16A34A',
          hover: '#15803D',
          light: '#E8F5E9',
        },
        academicBg: 'var(--es-canvas)',
        slate: {
          50: '#F8FAFC',
          100: '#F1F5F9',
          200: '#E5E7EB',
          300: '#D1D5DB',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

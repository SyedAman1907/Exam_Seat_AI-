/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          900: '#0F172A',
          800: '#14243A',
          700: '#1E293B',
          600: '#334155',
        },
        primary: {
          DEFAULT: '#2457A7', // Academic Blue
          hover: '#1B4282',
          light: '#EEF4FF',
          dark: '#14243A',
        },
        gold: {
          DEFAULT: '#D7A940',
          hover: '#BF922E',
          light: '#FEF9EC',
        },
        academicGreen: {
          DEFAULT: '#198754',
          hover: '#146C43',
          light: '#E8F5E9',
        },
        academicBg: '#F5F7FA',
        slate: {
          50: '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      }
    },
  },
  plugins: [],
}

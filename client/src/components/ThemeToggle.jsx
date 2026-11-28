import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

const ThemeToggle = ({ className = '' }) => {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
      title={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
      className={`h-10 inline-flex items-center gap-2 px-3.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer select-none ${
        isDark
          ? 'bg-[#1B2030] border-[#30384A] text-[#F8FAFC] hover:border-[#F472B6]/60'
          : 'bg-white border-[#E5E7EB] text-[#172033] hover:border-[#E83E8C]/50 hover:bg-[#F8DCEB]/30'
      } ${className}`}
    >
      {isDark ? (
        <>
          <Sun size={15} className="text-[#F472B6]" aria-hidden="true" />
          <span className="hidden sm:inline">Light Mode</span>
        </>
      ) : (
        <>
          <Moon size={15} className="text-[#E83E8C]" aria-hidden="true" />
          <span className="hidden sm:inline">Dark Mode</span>
        </>
      )}
    </button>
  );
};

export default ThemeToggle;

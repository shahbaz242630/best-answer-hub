/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        'bae-bg': '#FAFAF8',
        'bae-fg': '#1a1a2e',
        'bae-primary': '#6366f1',
        'bae-primary-soft': 'rgba(99,102,241,0.08)',
        'bae-accent': '#8b5cf6',
        'bae-accent-warm': '#c4b5fd',
        'bae-muted': '#6b6b80',
        'bae-border': '#e8e8f0',
        'bae-border-light': '#f0f0f6',
        'bae-card': '#ffffff',
        'bae-ink': '#0f0f1a',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['Playfair Display', 'Georgia', 'serif'],
      },
      borderRadius: {
        'bae': '12px',
        'bae-sm': '8px',
      },
      boxShadow: {
        'bae-sm': '0 1px 2px rgba(0,0,0,0.04)',
        'bae-md': '0 4px 20px rgba(0,0,0,0.06)',
        'bae-lg': '0 12px 40px rgba(0,0,0,0.08)',
      },
      maxWidth: {
        'content': '720px',
        'page': '1280px',
      },
      animation: {
        'pulse-dot': 'pulse-dot 2s infinite',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.5', transform: 'scale(0.9)' },
        },
      },
    },
  },
  plugins: [],
};

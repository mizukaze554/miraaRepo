/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./**/*.{html,js}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#0ea5a4',
          dark: '#0c8483',
        }
      },
      animation: {
        'progress': 'progress 1s ease infinite',
        'spin-slow': 'spin 3s linear infinite',
      },
      keyframes: {
        progress: {
          '0%': { width: '0%' },
          '100%': { width: '100%' },
        }
      }
    },
  },
  plugins: [],
}
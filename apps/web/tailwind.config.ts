import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#1d1d1f', 2: '#6e6e73', 3: '#8e8e93' },
        hairline: '#d2d2d7',
        canvas: '#f5f5f7',
        surface: '#ffffff',
        pos: '#1f8a4c',
        neg: '#d70015',
        warn: '#b25000',
        track: '#e8e8ed',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Text',
          'Inter',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      borderRadius: { md: '10px', sm: '6px' },
    },
  },
  plugins: [],
} satisfies Config;

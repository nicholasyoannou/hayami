/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './entrypoints/**/*.{ts,vue,html}',
    './components/**/*.{ts,vue,html}',
    './styles/**/*.{css,ts}',
    './utils/**/*.{ts,js}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};


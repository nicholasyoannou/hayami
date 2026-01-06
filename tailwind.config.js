/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/entrypoints/**/*.{ts,vue,html}',
    './src/components/**/*.{ts,vue,html}',
    './src/styles/**/*.{css,ts}',
    './src/utils/**/*.{ts,js}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};


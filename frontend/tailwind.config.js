/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#ecfdf5',
          100: '#d1fae5',
          500: '#10b981',
          600: '#059669',
          900: '#064e3b',
        },
        accent: {
          blue: '#3b82f6',
          teal: '#14b8a6',
          red: '#ef4444'
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      fontSize: {
        // Consolidates the ~84 hand-picked text-[Npx] arbitrary values found
        // across the app (text-[11.25px], text-[12.38px], text-[10.13px],
        // text-[11px], text-[10px]) into one rem-based token - those were
        // raw px, pre-multiplied by the html{font-size:112.5%} scale below,
        // which both defeats that scale rule and is exactly the kind of
        // fixed-px text a browser's "minimum font size" setting overrides
        // disproportionately relative to everything else on the page.
        '2xs': '0.625rem',
      },
    },
  },
  plugins: [],
}

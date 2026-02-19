/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        soft: "0 14px 40px -16px rgba(15, 23, 42, 0.6)",
      },
      backgroundImage: {
        "mesh-glow":
          "radial-gradient(circle at 10% 20%, rgba(56, 189, 248, 0.22), transparent 35%), radial-gradient(circle at 90% 10%, rgba(251, 191, 36, 0.18), transparent 30%), radial-gradient(circle at 50% 90%, rgba(14, 165, 233, 0.16), transparent 35%)",
      },
    },
  },
  plugins: [],
};

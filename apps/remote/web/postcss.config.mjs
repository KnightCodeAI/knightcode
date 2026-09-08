// Vite picks this up for the app under web/. The postcss plugin rather than @tailwindcss/vite
// because it is the one already hoisted in the workspace (apps/web uses it); nothing new downloads.
export default {
	plugins: { "@tailwindcss/postcss": {} },
};

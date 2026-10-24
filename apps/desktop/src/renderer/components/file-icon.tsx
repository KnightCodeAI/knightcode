import { createFileTreeIconResolver, getBuiltInSpriteSheet } from "@pierre/trees";

/**
 * A file's icon as the workspace tree draws it (@pierre/trees' "complete" set, coloured), so a tab, a Changes row and
 * the tree beside them agree: the Python logo for a .py file, a JS badge for .js. The set's sprite goes into the
 * document once, on the first icon drawn.
 */
const resolver = createFileTreeIconResolver({ set: "complete", colored: true });

let sprite = false;
function withSprite(): void {
	if (sprite) return;
	sprite = true;
	const holder = document.createElement("div");
	holder.hidden = true;
	holder.innerHTML = getBuiltInSpriteSheet("complete");
	document.body.append(holder);
}

/** The tree's palette (its --trees-icon-* colours), light and dark. */
const PALETTE = {
	gray: "light-dark(#84848a, #adadb1)",
	red: "light-dark(#d52c36, #ff6762)",
	vermilion: "light-dark(#ff8c5b, #d5512f)",
	orange: "light-dark(#d47628, #ffa359)",
	yellow: "light-dark(#d5a910, #ffd452)",
	green: "light-dark(#199f43, #5ecc71)",
	teal: "light-dark(#17a5af, #64d1db)",
	cyan: "light-dark(#1ca1c7, #68cdf2)",
	blue: "light-dark(#1a85d4, #69b1ff)",
	indigo: "light-dark(#693acf, #9d6afb)",
	purple: "light-dark(#a631be, #d568ea)",
	pink: "light-dark(#d32a61, #ff678d)",
	mauve: "light-dark(#594c5b, #79697b)",
};

/** Each kind of file's colour, as the tree's stylesheet gives it (--trees-file-icon-color-*); gray otherwise. */
const TONE: Record<string, keyof typeof PALETTE> = {
	astro: "purple",
	babel: "yellow",
	bash: "green",
	biome: "blue",
	bootstrap: "indigo",
	browserslist: "yellow",
	bun: "mauve",
	c: "blue",
	cpp: "blue",
	claude: "orange",
	css: "indigo",
	database: "purple",
	docker: "blue",
	eslint: "indigo",
	git: "vermilion",
	go: "cyan",
	graphql: "pink",
	html: "orange",
	image: "pink",
	javascript: "yellow",
	json: "orange",
	markdown: "green",
	mcp: "teal",
	npm: "red",
	oxc: "cyan",
	postcss: "red",
	prettier: "teal",
	python: "blue",
	react: "cyan",
	ruby: "red",
	rust: "orange",
	sass: "pink",
	svg: "orange",
	svelte: "red",
	svgo: "green",
	swift: "orange",
	table: "teal",
	tailwind: "cyan",
	terraform: "indigo",
	typescript: "blue",
	vite: "purple",
	vscode: "blue",
	vue: "green",
	wasm: "indigo",
	webpack: "blue",
	yml: "red",
	zig: "orange",
	zip: "orange",
};

export function FileIcon({ path }: { path: string }) {
	withSprite();
	const icon = resolver.resolveIcon("file-tree-icon-file", path);
	return (
		<svg
			aria-hidden="true"
			viewBox={icon.viewBox ?? "0 0 16 16"}
			width={16}
			height={16}
			style={{ color: PALETTE[TONE[icon.token ?? ""] ?? "gray"] }}
			className="shrink-0"
		>
			<use href={`#${icon.name}`} />
		</svg>
	);
}

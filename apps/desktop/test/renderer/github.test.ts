import { expect, test } from "vitest";
import { githubLink, githubRepo } from "../../src/renderer/github.ts";

test("a github.com remote in each form names its owner and repository; another host none", () => {
	for (const url of [
		"https://github.com/owner/repo.git",
		"https://user@github.com/owner/repo",
		"ssh://git@github.com:22/owner/repo.git",
		"git@github.com:owner/repo.git",
	])
		expect(githubRepo(url), url).toEqual({ owner: "owner", repo: "repo" });
	expect(githubRepo("git@gitlab.com:owner/repo.git")).toBeUndefined();
	expect(githubRepo("https://github.example.com/owner/repo")).toBeUndefined();
});

test("the link is the file at the branch and line, encoded; none outside the checkout or without a branch", () => {
	const origin = { root: "/repo", url: "git@github.com:owner/repo.git", branch: "feat/x y" };
	expect(githubLink(origin, "/repo/src/a b.ts", 12)).toBe(
		"https://github.com/owner/repo/blob/feat/x%20y/src/a%20b.ts#L12",
	);
	expect(githubLink(origin, "/repo/src/a.ts")).toBe("https://github.com/owner/repo/blob/feat/x%20y/src/a.ts");
	expect(githubLink(origin, "/elsewhere/a.ts")).toBeUndefined();
	expect(githubLink({ ...origin, branch: undefined }, "/repo/a.ts")).toBeUndefined();
	expect(githubLink({ root: "/repo", branch: "main" }, "/repo/a.ts")).toBeUndefined();
	// Windows paths compare without case and with either slash.
	expect(githubLink({ ...origin, root: "C:\\Work\\Repo", branch: "main" }, "c:\\work\\repo\\a.ts")).toBe(
		"https://github.com/owner/repo/blob/main/a.ts",
	);
});

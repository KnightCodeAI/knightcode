// Interaction states against the reference: menus, hovers, a tooltip and the avatar picker, each in both themes.
import { test } from "@playwright/test";
import { compareToReference } from "./reference/compare.ts";

const STATES = [
	"x-account-menu",
	"x-menu-item-hover",
	"x-search",
	"x-composer-menu",
	"x-message-hover",
	"x-row-hover",
	"x-button-hover",
	"x-icon-button-hover",
	"x-avatar-picker",
];

for (const state of STATES) test(`${state} matches the reference`, async ({ page }) => compareToReference(page, state));

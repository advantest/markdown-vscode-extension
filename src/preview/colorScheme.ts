/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

/** The colour scheme the preview shows, as the page's stylesheets know it. */
export interface ColorScheme {
	readonly scheme: 'light' | 'dark';
	/** Whether the page takes the colours of VS Code's colour theme, which fit a dark page in a dark theme only. */
	readonly themeColors: boolean;
}

/**
 * The colour scheme in effect for the setting `preview.colorScheme` under a light or a dark colour theme. `auto`,
 * and a value that is none of the setting's, follows the theme. Light always has FluentMark's colours; dark has the
 * theme's colours in a dark theme and the page's own dark palette in a light one.
 */
export function colorScheme(setting: unknown, darkTheme: boolean): ColorScheme {
	const scheme = setting === 'light' || setting === 'dark' ? setting : darkTheme ? 'dark' : 'light';
	return { scheme, themeColors: scheme === 'dark' && darkTheme };
}

/** The media query of the style of code made for one scheme: every medium where the page shows that scheme, else none. */
export function codeStyleMedia(style: ColorScheme['scheme'], shown: ColorScheme['scheme']): string {
	return style === shown ? 'all' : 'not all';
}

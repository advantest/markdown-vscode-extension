import * as path from 'node:path';

/**
 * The roots of the file system, so that the preview may show a local image from anywhere, as FluentMark does: `/`,
 * or on Windows every drive, whether it exists yet or not, and the network shares of the given paths.
 */
export function fileSystemRoots(platform: NodeJS.Platform, paths: readonly string[]): string[] {
	if (platform !== 'win32') {
		return ['/'];
	}
	const drives = Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`);
	const shares = paths.map((file) => path.win32.parse(file).root).filter((root) => root.startsWith('\\\\'));
	return [...new Set([...drives, ...shares])];
}

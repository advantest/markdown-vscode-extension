/** What the page of the preview needs to know about where it is shown. */
export interface PageResources {
	/** The source of the content security policy that stands for the resources of the webview. */
	readonly cspSource: string;
	/** The webview address of the extension's dist/media folder, without a trailing slash. */
	readonly media: string;
	/** The webview address of the document's folder, with a trailing slash; absent where there is none. */
	readonly base: string | undefined;
}

function escape(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The page of the preview. It reproduces FluentMark's preview page, but loads everything from the extension; the
 * content arrives later by a message and goes into the element "app".
 */
export function previewPage({ cspSource, media, base }: PageResources): string {
	const csp = [
		"default-src 'none'",
		`script-src ${cspSource}`,
		`style-src ${cspSource} 'unsafe-inline'`,
		`img-src ${cspSource} https: http: data:`,
	].join('; ');
	const file = (name: string) => escape(`${media}/${name}`);
	return `<!DOCTYPE html>
<html>
	<head>
		<meta charset="utf-8">
		<meta http-equiv="Content-Security-Policy" content="${escape(csp)}">
		<meta name="viewport" content="width=device-width,initial-scale=1.0">
		<title>Markdown Preview</title>
${base === undefined ? '' : `		<base href="${escape(base)}">\n`}		<link rel="stylesheet" href="${file('default.css')}">
		<link rel="stylesheet" href="${file('preview.css')}">
		<link rel="stylesheet" href="${file('highlight/default.min.css')}">
		<script src="${file('highlight/highlight.min.js')}"></script>
		<script src="${file('mathjax-config.js')}"></script>
		<script id="MathJax-script" async src="${file('mathjax/es5/tex-mml-svg.js')}"></script>
	</head>
	<body style="overflow:auto">
		<span id="app"></span>
		<script src="${file('preview.js')}"></script>
	</body>
</html>
`;
}

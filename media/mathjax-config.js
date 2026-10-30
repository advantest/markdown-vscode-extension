window.MathJax = {
	options: {
		enableMenu: true,
		ignoreHtmlClass: 'tex2jax_ignore',
		processHtmlClass: 'tex2jax_process'
	},
	tex: {
		inlineMath: [ ['$','$'], ['\\(','\\)'] ],
		displayMath: [ ['$$','$$'], ['\\[','\\]'] ],
		processEscapes: true,
		tags: "ams",
		autoload: {
			color: [],
			colorv2: ['color']
		}
	},
	loader: {
		load: ['input/asciimath']
	}
};

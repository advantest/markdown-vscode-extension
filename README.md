# markdown-vscode-extension

Markdown support for Visual Studio Code: validation, an HTML preview, editing aids and refactorings of
Markdown documents.

## How it works

The extension is a language client written in TypeScript. It starts the Markdown language server
`markdown-ls` on a Java runtime and talks to it over standard input and output. The server does the
language work — parsing, validation, completion, formatting and rendering HTML — and the extension
brings its results into the editor:

- **Language client** — starts the server for Markdown documents and connects to it.
- **Editor integration** — settings, commands and keybindings, and how the server's results are
  shown.
- **Preview** — a webview showing the HTML the server renders.

## Requirements

A Java 21 runtime, to run the server. A setting naming the Java executable takes precedence over
`JAVA_HOME` and the `PATH`.

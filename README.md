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

- **Java 21** or newer, to run the server. The Java set in `markdownSupport.java.path` is taken if
  there is one; otherwise the first Java 21 found in `JAVA_HOME` and then on the `PATH`.
- **The JAR of `markdown-ls`**, set in `markdownSupport.server.jar`. The extension starts it with
  `java [VM arguments] -jar <JAR>`; the libraries the JAR needs are found in the directory `lib` next
  to it, as in the distribution of `markdown-ls`.

## Settings

| Setting                         | Description                                                                       |
|---------------------------------|-----------------------------------------------------------------------------------|
| `markdownSupport.java.path`     | The Java executable to run the server with.                                       |
| `markdownSupport.server.jar`    | The JAR of the language server.                                                   |
| `markdownSupport.server.vmArgs` | Options for the Java VM, e.g. `-Xmx1g`.                                           |
| `markdownSupport.trace.server`  | Logs the messages between VS Code and the server: `off`, `messages` or `verbose`. |

The first three are user settings only, since they decide which program is run; changing one of them
restarts the server. The server's messages are shown in the output channel "Markdown Support".

## Building

Node.js 22 or newer and npm are needed.

```sh
npm ci              # installs the dependencies as locked in package-lock.json
npm run compile     # checks the types and bundles the extension into dist/extension.js
npm run package     # builds the VSIX file to install into VS Code
```

## Running

Open the repository in VS Code and start the launch configuration "Run Extension". It opens a second
VS Code window with the extension loaded. The VSIX file can be installed with "Extensions: Install from
VSIX…".

## Testing

```sh
npm test
```

runs the unit tests, the tests inside VS Code (which is downloaded into `.vscode-test/` the first
time) and reports the coverage of both together; the HTML report is written to `coverage/html`.

The end-to-end tests run the extension against the real server. They are skipped unless two
environment variables name the server's JAR and a Java 21:

```sh
MARKDOWN_SUPPORT_TEST_SERVER_JAR=/path/to/markdown-ls/markdown-ls.jar
MARKDOWN_SUPPORT_TEST_JAVA=/path/to/jdk-21/bin/java
```

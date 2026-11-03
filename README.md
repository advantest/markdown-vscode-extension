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

- **Java 21** or newer, to run the server. The Java installation whose folder is set in
  `markdownSupport.java.home` is taken if there is one, e.g. `/usr/lib/jvm/java-21`; otherwise the first
  Java 21 found in `JAVA_HOME` and then on the `PATH`.
- **The JAR of `markdown-ls`**, set in `markdownSupport.server.jar`. The extension starts it with
  `java [VM arguments] -jar <JAR>`; the libraries the JAR needs are found in the directory `lib` next
  to it, as in the distribution of `markdown-ls`.

## Preview

The preview shows the HTML the server renders from a Markdown document, with the unsaved changes. It is
updated shortly after a change and at once when the document is saved. There is only ever one preview;
the commands below show their document in it, in place of the one it showed. It follows the editor:
when the editor shows another Markdown document, e.g. after the back button, the preview shows that
one. Code is highlighted with highlight.js and formulas are typeset with MathJax, both shipped with the
extension; nothing is loaded from the web except images the document links to. Relative images and
links are resolved against the folder of the document, and an image may be any local file; an image
changed on disk shows when the preview is updated. The preview looks the same in every colour theme.

| Command                               | Title                    | Description                                     |
|---------------------------------------|--------------------------|-------------------------------------------------|
| `markdownSupport.preview.open`        | Open Preview             | Opens the preview in place of the editor.       |
| `markdownSupport.preview.openToSide`  | Open Preview to the Side | Opens the preview beside the editor.            |
| `markdownSupport.preview.toggle`      | Toggle Preview           | Switches between the document and its preview.  |
| `markdownSupport.preview.showElement` | Show in Preview          | Shows the element at the cursor in the preview. |

"Show in Preview" outlines the element for two seconds. The commands are in the command palette under
"Markdown Support", in the title bar of the editor and the preview, and in the context menus of the
explorer and the editor. They have no keybindings; assign them with "Preferences: Open Keyboard
Shortcuts".

In the preview:

- A link to an anchor scrolls the preview and the editor; a link to another Markdown document opens it in the editor
  and the preview, both scrolled to its anchor; a link to another file opens it in its default editor.
- A web address opens in VS Code's integrated browser, the one open already if there is one, or in the
  system browser where `markdownSupport.preview.openWebLinksIn` says so or VS Code has no integrated
  browser.
- **Ctrl + click** (**Cmd + click** on macOS) on an element selects its source in the editor.
- **Alt + mouse wheel** zooms an image or a diagram, dragging it with the left mouse button moves it,
  the right mouse button resets it.

## Settings

| Setting                                  | Description                                                             |
|------------------------------------------|-------------------------------------------------------------------------|
| `markdownSupport.java.home`              | The folder of the Java installation to run the server with.             |
| `markdownSupport.server.jar`             | The JAR of the language server.                                         |
| `markdownSupport.server.vmArgs`          | Options for the Java VM, e.g. `-Xmx1g`.                                 |
| `markdownSupport.trace.server`           | Logs the messages with the server: `off`, `messages` or `verbose`.      |
| `markdownSupport.preview.openWebLinksIn` | Where clicked web addresses open: `integratedBrowser`, `systemBrowser`. |

The first three are user settings only, since they decide which program is run; changing one of them
restarts the server. The settings editor marks a value that cannot be right, e.g. a JAR not ending in
`.jar` or the Java executable in place of its installation folder. Whether a file exists is found out
when the server is started: the message names the setting, and its button "Open Settings" shows that
setting. The server's messages are shown in the output channel "Markdown Support".

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
environment variables name the server's JAR and the folder of a Java 21:

```sh
MARKDOWN_SUPPORT_TEST_SERVER_JAR=/path/to/markdown-ls/markdown-ls.jar
MARKDOWN_SUPPORT_TEST_JAVA_HOME=/path/to/jdk-21
```

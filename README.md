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

The server `markdown-ls` comes with the extension, in its folder `server/`: the JAR and, in `lib/`, the
libraries it needs. The extension starts it with `java -jar <JAR>` and logs which server it starts in the
output channel "Markdown Support". Options for the Java VM, e.g. to debug the server, are taken from the
environment variable `JAVA_TOOL_OPTIONS`, which every Java VM reads.

## A server another extension declares

Another extension may declare a server, e.g. one that adds features to `markdown-ls`, in its
`package.json`; it needs no code for it:

```json
"markdownSupport": {
  "server": { "jar": "server/launcher.jar", "markdownLs": "1.2.0" }
}
```

`jar` is relative to the folder of that extension, and `markdownLs` is the version of `markdown-ls` the
declared server holds. Before it starts a server, the extension reads the declarations of all installed
extensions. It starts the declared server, with `java -jar` and the same Java, if exactly one extension
declares a server, its JAR is in that extension's folder and exists, and its version is accepted: the
major version of the bundled server, from the minor version on that `package.json` names under
`markdownSupport.declaredServer.minimumVersion`. Only the major and the minor version are compared, so a
pre-release such as `1.0.0-SNAPSHOT` counts as 1.0. Without a declaration it starts the bundled server; in
any other case as well, and it shows an error message saying why the features of the declared server are
missing. A declared server that crashes is restarted, never replaced by the bundled one.

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
| `markdownSupport.preview.showElement` | Show in Preview          | Shows the element at the cursor in the preview. |

"Show in Preview" outlines the element for two seconds. The commands are in the command palette under
"Markdown Support", in the title bar of the editor, and in the context menus of the explorer and the
editor. They have no keybindings; assign them with "Preferences: Open Keyboard Shortcuts". The preview
has no command that replaces it with its source.

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
| `markdownSupport.trace.server`           | Logs the messages with the server: `off`, `messages` or `verbose`.      |
| `markdownSupport.preview.openWebLinksIn` | Where clicked web addresses open: `integratedBrowser`, `systemBrowser`. |

`markdownSupport.java.home` is a user setting only, since it decides which program is run; changing it
restarts the server. The settings editor marks a value that cannot be right, e.g. the Java executable in
place of its installation folder. Whether the folder holds a Java 21 is found out when the server is
started: the message names the setting, and its button "Open Settings" shows that setting. The server's
messages are shown in the output channel "Markdown Support".

## Building

Node.js 22 or newer and npm are needed.

```sh
npm ci                # installs the dependencies as locked in package-lock.json
npm run compile       # checks the types and bundles the extension into dist/extension.js
npm run fetch-server  # unpacks the server's distribution into server/
npm run package       # fetches the server and builds the VSIX file to install into VS Code
```

The version of `markdown-ls` the extension bundles is pinned in `package.json`, under
`markdownSupport.defaultServer`, by its Maven coordinates. `npm run fetch-server` takes the distribution of
that version, `markdown-ls-<version>-distribution.zip`, from the Maven repository named by the
environment variable `MARKDOWN_LS_REPOSITORY`, a folder or an `http(s)` address, by default the local
repository `~/.m2/repository`. It checks that the JAR is of the pinned version. A snapshot can only be
taken from a folder, e.g. after `mvn install` in `markdown-ls`.

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

The tests inside VS Code that need no server set the environment variable `MARKDOWN_SUPPORT_TEST_NO_SERVER`,
so that the extension neither looks for Java nor starts the server; they need no Java and behave the same on
every machine. The extension reads the variable only while it is tested.

The end-to-end tests run the extension against the server bundled with it. The runs `e2e-declared` and
`e2e-several` install extensions without code next to it, which `test/stubExtensions.mjs` builds into
`.vscode-test/stubs/` and which declare a server: one that is started in place of the bundled server, and
two, so that the bundled server is started. They are skipped unless the
server has been fetched with `npm run fetch-server` and an environment variable names the folder of a
Java 21, which the test run sets in `markdownSupport.java.home` before VS Code starts:

```sh
MARKDOWN_SUPPORT_TEST_JAVA_HOME=/path/to/jdk-21
```

While the extension runs from its sources or under test, the environment variable
`MARKDOWN_SUPPORT_TEST_SERVER_JAR` may name another JAR of the server, e.g. one just built, to start in
place of the bundled one or a declared one; no declaration is read then. An installed extension ignores it.
`MARKDOWN_SUPPORT_TEST_NO_SERVER` ranks above both.

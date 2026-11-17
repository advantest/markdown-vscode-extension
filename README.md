# markdown-vscode-extension

Markdown support for Visual Studio Code: validation, an HTML preview, editing aids and refactorings of
Markdown documents.

This README is for those who build and develop the extension. What its users see in VS Code, on the extension's
Details tab, is [`EXTENSION-DETAILS.md`](EXTENSION-DETAILS.md).

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
  Java 21 found in `JAVA_HOME` and then on the `PATH`. On Windows, the path of the Java installation may
  hold only characters of the ANSI code page, e.g. Windows-1252; Java does not start from a folder
  named with others, e.g. Greek or Japanese ones.

The server `markdown-ls` comes with the extension, in its folder `server/`: the JAR and, in `lib/`, the
libraries it needs. Next to them lie the server's `LICENSE` and `THIRD-PARTY.txt`, which lists the
third-party libraries with their licences, those inside PlantUML's JAR included, the texts of these
licences in `licenses/`, the libraries' notices in `notices/`, and in `sources/` the source of the libraries
under the GPL. The extension starts the server with `java -jar <JAR file name>` in the folder of the JAR, so
that the path to it may hold any character, and logs which server it starts in the output channel
"Markdown Support". Options for the Java VM, e.g. to debug the server, are taken from the
environment variable `JAVA_TOOL_OPTIONS`, which every Java VM reads.

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
| `markdownSupport.plantUml.dotExecutable` | Graphviz's `dot` for PlantUML; empty: `GRAPHVIZ_DOT`, then the usual.  |

`markdownSupport.java.home` is a user setting only, since it decides which program is run; changing it
restarts the server. The settings editor marks a value that cannot be right, e.g. the Java executable in
place of its installation folder. Whether the folder holds a Java 21 is found out when the server is
started: the message names the setting, and its button "Open Settings" shows that setting. The server's
messages are shown in the output channel "Markdown Support".

`markdownSupport.plantUml.dotExecutable` is sent to the running server when it changes. Its description
links to two read-only views of what the server runs with, which the command palette also offers under
"Markdown Support":

| Command                                        | Title                      | Shows                                                                 |
|------------------------------------------------|----------------------------|-----------------------------------------------------------------------|
| `markdownSupport.environment.showPlantUml`     | Show PlantUML and Graphviz | PlantUML's version, security profile, URL allowlist; Graphviz's `dot` |
| `markdownSupport.environment.showDependencies` | Show Dependencies          | The extensions, the libraries of the server, and their versions       |

Each view asks the server whenever it is opened; running its command again refreshes it. Without a
running server, the view says so. "Dependencies" lists this extension first and, where the server that runs
is one another extension declares, that extension too, each with its version.

## Customization options

The extension can be extended without changing it: another extension may bring a server of its own in place of
the bundled one.

### A server another extension declares

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

## Building

Node.js 26 or newer and the npm it brings, 11.20 or newer, are needed.

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

`npm run notices`, which `npm run package` runs too, writes `ThirdPartyNotices.txt`: every third-party component
the VSIX ships besides the server, with its licence texts. These are the npm packages bundled into
`dist/extension.js`, as esbuild reports them in `out/bundled.json`, the packages copied into `dist/media/`, and
the preview's stylesheet `media/default.css`, whose licence texts lie in `third-party/default.css/`.

`npm run sbom`, which `npm run package` runs too, writes `bom.json`, the CycloneDX SBOM of the VSIX. It takes the
extension's npm dependencies from `cyclonedx-npm`, adds the server with all it holds from `server/bom.json`, and
the preview's stylesheet.

`npm run check-package`, which `npm run package` runs last, checks that the VSIX carries `EXTENSION-DETAILS.md` as
the page VS Code shows in the extension's Details tab and `CHANGELOG.md` as its Changelog tab.

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

Before them, `npm run lint` runs ESLint, which also checks that every TypeScript, JavaScript and CSS file of
our own starts with the copyright notice and the SPDX identifier of the licence; `npx eslint --fix` adds a
missing one with the current year.

The tests inside VS Code that need no server set the environment variable `MARKDOWN_SUPPORT_TEST_NO_SERVER`,
so that the extension neither looks for Java nor starts the server; they need no Java and behave the same on
every machine. The extension reads the variable only while it is tested.

The end-to-end tests run the extension against the server bundled with it. The run `e2e-non-ansi` starts a
copy of it in a folder named with Greek and Japanese characters. The runs `e2e-declared` and
`e2e-several` install extensions without code next to it, which `test/stubExtensions.mjs` builds into
`.vscode-test/stubs/` and which declare a server: one that is started in place of the bundled server, and
two, so that the bundled server is started. They fail unless the server has been fetched with
`npm run fetch-server` and an environment variable names the folder of a Java 21, which the test run sets in
`markdownSupport.java.home` before VS Code starts:

```sh
MARKDOWN_SUPPORT_TEST_JAVA_HOME=/path/to/jdk-21
```

While the extension runs from its sources or under test, the environment variable
`MARKDOWN_SUPPORT_TEST_SERVER_JAR` may name another JAR of the server, e.g. one just built, to start in
place of the bundled one or a declared one; no declaration is read then. An installed extension ignores it.
`MARKDOWN_SUPPORT_TEST_NO_SERVER` ranks above both.

### The rendering tests for another extension

The tests of what the preview shows of every kind of content, `test/rendering/suite.ts`, check the preview
against whichever server runs, so an extension declaring a server can run the same tests. It depends on this
extension as a development dependency pinned to a commit, e.g.
`"markdown-support": "git+<address of this repository>#<commit>"`. npm then runs the script `prepare`, which
builds the extension and compiles the tests, and installs what `.npmignore` lets through: `dist/`, `images/`
and `out/test/rendering/`, but not the bundled server. `node_modules/markdown-support` is then the extension
to load as a development path next to the declaring one, and its tests define the suite within a `describe`
of their own:

```js
require('markdown-support/out/test/rendering/suite').describeRendering({
  before: async (api) => { /* e.g. checks api.runningServer() before the document is previewed */ },
  ticketLink: /\/browse\/HMR-122$/, // if the server links text like HMR-122; without it, it stays text
});
```

The suite writes its documents and files into a temporary folder itself. `npm ci` runs `prepare` here too.

## License

This work is made available under the terms of the BSD 3-Clause License.
The licence accompanies the extension, in the file `LICENSE`.
The third-party components it ships come under their own licences, listed in `ThirdPartyNotices.txt`.

## Copyright

Copyright (c) 2026, Advantest Europe GmbH.
All rights reserved.

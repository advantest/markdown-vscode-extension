# Markdown Support

Markdown Support complements the built-in Markdown features. It adds:

- **Preview** — shows a Markdown document as HTML next to its source, with highlighted code, typeset
  formulas and PlantUML diagrams, and keeps up with your typing. It knows which part of the source each
  element comes from, so you can jump back and forth between the source and the preview, and it follows
  you through the links between your documents.
- **Validation** — finds broken links, missing files, missing anchors and unreachable web addresses
  while you type, and lists them in the Problems view.

## Getting started

### Requirements

- **Visual Studio Code** 1.91 or newer.
- **Java 21** or newer. The extension's language server runs on Java and comes with the extension; the
  Java itself does not. On Windows, the folder Java is installed in may only be named with characters of
  the ANSI code page, e.g. Windows-1252; Java does not start from a folder named with others, e.g.
  Greek or Japanese ones.
- **Graphviz**, optionally, for PlantUML diagrams other than sequence diagrams.

### Installation

Java is only needed to run the extension's Markdown language server, which offers all its features: it
parses the Markdown, renders the HTML for the preview and checks the sources.

Install the extension from the Extensions view: open it with **Ctrl+Shift+X** (**Cmd+Shift+X** on
macOS), click **…** at the top of the view, choose **Install from VSIX…** and select the extension's
VSIX file.

The extension starts as soon as you open a Markdown document. It then looks for Java in this order:

1. the folder set in the setting `markdownSupport.java.home`,
2. the environment variable `JAVA_HOME`,
3. the `PATH`.

If it finds no Java 21 there, it tells you so in a message whose button **Open Settings** takes you to
the setting `markdownSupport.java.home`.

### Configuration

Open the settings with **Ctrl+,** (**Cmd+,** on macOS) and search for "Markdown Support".

| Setting                                  | What it does                                                         |
|------------------------------------------|----------------------------------------------------------------------|
| `markdownSupport.java.home`              | The folder of the Java installation to run with, the one with `bin`. |
| `markdownSupport.plantUml.dotExecutable` | Graphviz's `dot`; if empty, `GRAPHVIZ_DOT` and the usual places.     |
| `markdownSupport.preview.colorScheme`    | Whether the preview is light, dark, or follows the colour theme.     |
| `markdownSupport.preview.openWebLinksIn` | Where a web address clicked in the preview opens.                    |
| `markdownSupport.trace.server`           | Logs the messages with the language server.                          |

`markdownSupport.java.home` can only be set in the user settings, not in a workspace, since it decides
which program is run. Changing it restarts the language server.

## Preview

The preview shows the open Markdown document as HTML, including the changes you have not saved yet.
It is updated shortly after you type and at once when you save.

### Opening the preview

- **Beside the editor:** click the icon **Open Preview to the Side** at the top right of the editor, a
  split page with an eye.
- **In place of the editor:** hold **Alt** and click the same icon, or right-click the document in the
  Explorer and choose **Open Preview**.
- **At the element under the cursor:** right-click in the editor and choose **Show in Preview**. The
  element is outlined in the preview for two seconds.

All three are commands in the Command Palette as well: press **Ctrl+Shift+P** (**Cmd+Shift+P** on macOS)
and type "Markdown Support". They have no keyboard shortcuts of their own; assign some with
**Preferences: Open Keyboard Shortcuts** if you like.

There is only ever one preview. It follows the editor: when the editor shows another Markdown
document, the preview shows that one.

While a document is being rendered, the preview says so, "Rendering file.md", with a spinner: at the
top right over what it shows, or in the middle where it shows nothing yet. If rendering fails, it says
why. A preview with nothing to show says "Open a Markdown file to be rendered."

### Light and dark

By default the preview is light in a light colour theme and dark in a dark or high-contrast one. The
setting `markdownSupport.preview.colorScheme` keeps it light or dark in every theme instead. Light has
the colours of FluentMark's preview. Dark takes the colours of the dark theme you use, and a palette of
its own under a light theme. Code is highlighted in Stack Overflow's colours, light or dark with the
preview, and PlantUML diagrams are drawn light or dark with it. The preview changes its colours at once
when you change the setting or the theme; when it turns light or dark, it renders the document again
for the diagrams and says so over its content.

Two things a dark preview does not adapt; where they get hard to read, the light colour scheme shows them as
intended:

- Images of the document stay as they are. One with a transparent background drawn for a light page, e.g. a logo
  with black lettering or an SVG with dark lines, can be hard to make out on a dark page.
- PlantUML diagrams are drawn in PlantUML's own dark mode, which only changes the default colours. Colours a
  diagram or a library sets itself, e.g. the light fills of the Archimate library, stay, while the text turns light,
  so it may end up light on a light background.

### Navigation in the preview and in the sources

- **Right-click in the editor and choose Show in Preview** to jump from a position in the source to the
  element rendered from it: the preview scrolls to that element and outlines it for two seconds.
- **Click a link to an anchor** to scroll both the preview and the editor to it.
- **Click a link to another Markdown document** to open it in the editor and the preview.
- **Go back** to the document you came from with **Alt+Left** (**Ctrl+-** on macOS, **Ctrl+Alt+-** on
  Linux), and forward again with **Alt+Right** (**Ctrl+Shift+-** on macOS and Linux): the preview follows
  the editor.
- **Click a link to another file** to open it in its default editor.
- **Click a web address** to open it in VS Code's integrated browser, or in the system's browser if the
  setting `markdownSupport.preview.openWebLinksIn` says so.
- **Ctrl+click** (**Cmd+click** on macOS) an element to select its source in the editor.
- **Alt+mouse wheel** over an image or a diagram zooms it; dragging it with the left mouse button moves
  it, and the right mouse button resets it.

Code is highlighted and formulas are typeset by the extension itself; nothing is loaded from the web
except the images your document links to. Relative links and images are resolved against the folder of
the document.

## Validation

The extension checks every Markdown document you open, again shortly after each change and when you
save it. What it finds is underlined in the editor and listed in the Problems view, which **Ctrl+Shift+M**
(**Cmd+Shift+M** on macOS) opens. Hover over an underlined spot to read what is wrong.

It reports:

- links and images whose relative path names a file or folder that does not exist,
- links to an anchor or a heading the target document does not have,
- headings and anchors whose identifiers are invalid or used twice,
- reference links without a definition, and definitions used twice,
- malformed or empty links and web addresses,
- web addresses whose server cannot be reached, and links with a scheme it does not know.

Web addresses are checked online, so their checks need a network connection.

## Troubleshooting

The extension writes what it does, e.g. which language server and which Java it starts, into the output
channel "Markdown Support": open the Output view with **Ctrl+Shift+U** (**Cmd+Shift+U** on macOS) and
choose it there. The setting `markdownSupport.trace.server` adds the messages exchanged with the language
server.

Two commands in the Command Palette show what the language server runs with:

| Command                                          | Shows                                                      |
|--------------------------------------------------|------------------------------------------------------------|
| **Markdown Support: Show PlantUML and Graphviz** | PlantUML's version and security settings, Graphviz's `dot` |
| **Markdown Support: Show Dependencies**          | The extensions and the server's libraries, with versions   |

## License

Markdown Support is available under the BSD 3-Clause License, which comes with the extension in its file
`LICENSE`. The third-party components it ships come under their own licences, listed in its files
`ThirdPartyNotices.txt` and `server/THIRD-PARTY.txt`.

## Copyright

Copyright © 2026 Advantest Europe GmbH. All rights reserved.

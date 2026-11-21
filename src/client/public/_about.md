# Planck Bin

Sharing code is a good thing, and it should be _really_ easy to do it.
A lot of times, I want to show you something I'm seeing - and that's where we use pastebins.

Planck Bin is a pastebin that runs on Cloudflare Workers.

## Basic Usage

Type what you want to share, press **Ctrl+Enter** (**Cmd+Enter** on Mac) to save, and then copy the URL. Send that URL
to someone and they'll see exactly what you see.

To make a new entry, press **Alt+Shift+P** (**Opt+Shift+P** on Mac) or pick "New paste" in the
command palette.

## Command Palette

Press **Ctrl+/** or click the pill in the top-right corner. Type to filter commands, then
press Enter.

- **:42** - go to line 42
- **?text** - find text in the paste (Enter / Shift+Enter for next / previous)
- **Switch language** - change syntax highlighting
- **Recent pastes** - pastes you saved or opened in this browser (stored only locally)
- **Expires** - how long new pastes are kept (while editing)
- **Burn after reading** - make the next paste readable only once (while editing)

## Keyboard Shortcuts

- **Ctrl+/** - Open the command palette (also on Mac)
- **Ctrl+S** or **Ctrl+Enter** - Save your paste (**Cmd+S** / **Cmd+Enter** on Mac)

The rest use **Alt+Shift** on Windows and Linux, **Opt+Shift** on Mac:

- **P** - New paste
- **D** - Duplicate and edit
- **C** - Copy paste link to clipboard
- **R** - Open raw view in a new tab
- **F** - Find in paste
- **G** - Go to line
- **L** - Switch language
- **H** - Recent pastes
- **=** / **-** / **0** - Zoom in / out / reset
- **X** - Share on Twitter

## Drafts

Anything you type is kept as a local draft in your browser. Close the tab,
come back later, and your unsaved text is restored.

## Duration

Pastes are stored for 30 days from their creation date unless you pick another lifetime with
**Expires** in the command palette: 3 days, 1 week, 1 month, 6 months or permanent. The choice is
remembered in your browser. An instance may cap the longest lifetime.

## Burn After Reading

Turn on **Burn after reading** before saving to create a paste that can be read once. Whoever opens
the link is asked first; clicking **Open and burn** shows the paste and deletes it from the server,
and the link stops working. Nothing of the paste reaches the browser before that click. Link previews in chat apps do not count as a read. Reading
it through `/raw/` or the API deletes it right away.

## Privacy

There should be no expectation of privacy. Post things at your own risk. Burn after reading
limits how long a paste lives, but pastes are not encrypted.
Not responsible for any loss of data or removed pastes.

## Technology

Planck Bin runs on Cloudflare's global edge network:

- **Cloudflare Workers** - Serverless compute at 300+ locations worldwide
- **D1 Database** - SQLite database at the edge
- **TypeScript** - Modern, type-safe codebase
- **Vite** - Lightning-fast development and builds

## Open Source

Planck Bin is open source. You can deploy it to your own Cloudflare account.

- **This**: [planck-bin](https://github.com/sigman78/planck-bin)
- **Original**: [haste-server](https://github.com/seejohnrun/haste-server) by John Crepezzi
- **CLI client**: [haste-client](https://github.com/seejohnrun/haste-client) (API compatible)

## Credits

Original Haste by John Crepezzi <john.crepezzi@gmail.com>
Key Design by Brian Dawson <bridawson@gmail.com>
Planck Bin - SiGMan <sigman@ioupg.com>

# Haste

Sharing code is a good thing, and it should be _really_ easy to do it.
A lot of times, I want to show you something I'm seeing - and that's where we use pastebins.

Haste is the prettiest, easiest to use pastebin ever made.

## Basic Usage

Type what you want to share, press **Ctrl+Enter** to save, and then copy the URL. Send that URL
to someone and they'll see exactly what you see.

To make a new entry, open the command palette and pick "New paste" (or press **Alt+Shift+N**).

## Command Palette

Press **Ctrl+/** or click the pill in the top-right corner. Type to filter commands, then
press Enter.

- **:42** - go to line 42
- **/text** - find text in the paste (Enter / Shift+Enter for next / previous)
- **Switch language** - change syntax highlighting
- **Recent pastes** - pastes you saved or opened in this browser (stored only locally)

## Keyboard Shortcuts

- **Ctrl+/** - Open the command palette
- **Ctrl+Enter** (or Ctrl+S) - Save your paste
- **Alt+Shift+N** - Create new paste
- **Alt+Shift+D** - Duplicate and edit
- **Alt+Shift+C** - Copy paste link to clipboard
- **Alt+Shift+R** - Open raw view in a new tab
- **Alt+Shift+X** - Share on Twitter

## Drafts

Anything you type is kept as a local draft in your browser. Close the tab,
come back later, and your unsaved text is restored.

## Duration

Pastes are stored for 30 days from their creation date.

## Privacy

There should be no expectation of privacy. Post things at your own risk.
Not responsible for any loss of data or removed pastes.

## Technology

This Haste server runs on Cloudflare's global edge network:

- **Cloudflare Workers** - Serverless compute at 300+ locations worldwide
- **D1 Database** - SQLite database at the edge
- **TypeScript** - Modern, type-safe codebase
- **Vite** - Lightning-fast development and builds

## Open Source

Haste can easily be installed behind your network, and it's all open source!

- **This**: [Modern Cloudflare rework](https://github.com/sigman78/cf-haste-server)
- **Original**: [haste-server](https://github.com/seejohnrun/haste-server) by John Crepezzi
- **CLI client**: [haste-client](https://github.com/seejohnrun/haste-client)

## Credits

Original Haste by John Crepezzi <john.crepezzi@gmail.com>
Key Design by Brian Dawson <bridawson@gmail.com>
Modernized for Cloudflare - SiGMan <sigman@ioupg.com>

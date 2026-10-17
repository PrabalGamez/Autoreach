# Autoreach

Local outreach app for independent creators. It researches labels, brands and collaborators, drafts one personal email per target, lets you review drafts as flashcards, sends approved ones from your Gmail, watches for replies and alerts you when an offer arrives.

All AI work runs through your own Claude Code install (`claude -p`), with your login and plan. There is no API key and no hosted backend. Data stays in `~/.autoreach/`; OAuth secrets live in the macOS Keychain.

## Install

In Claude Code:

```bash
claude plugin marketplace add PrabalGamez/autoreach
claude plugin install autoreach@autoreach
```

Restart Claude Code, then run `/autoreach`. The first launch installs dependencies and builds the app, which takes a minute. Needs Node 20+ and a signed-in terminal `claude`.

## Use

In Claude Code:

- `/autoreach` starts the local server on `127.0.0.1:4747` and opens the app.
- `/autoreach status` prints the pipeline, queue and any pending offers.
- `/autoreach stop` shuts the server down. Queued emails wait until you open it again.

The app only sends while the server runs. If the laptop sleeps, the queue pauses and resumes without bursting.

## One-time setup

1. **Claude Code in the terminal must be signed in.** Run `claude auth login` (or `claude`, then `/login`). The desktop app login does not cover the terminal CLI. Autoreach shows a connecting screen, and a blocking screen until this works.
2. **Your Gmail address. That's it.** By default Autoreach never touches your inbox and stores no passwords or tokens. Each email you approve opens in Gmail's compose window, already written, and you press Send. When someone replies, press "Log reply" on that target and paste it; Claude reads it, flags offers and honours opt-outs. "Check Gmail for replies" opens one Gmail search covering everyone you pitched.
3. **Optional: automatic mode.** If you want Autoreach to send on its own and watch replies, open "Advanced" on the Gmail step and connect your own Google OAuth client (Desktop app type, `gmail.send` + `gmail.readonly`, published "In production"). Secrets go in the macOS Keychain.

## Safety rules built in

- Nothing sends without an explicit approval on its own flashcard. There is no bulk approve.
- A daily cap applies in both modes (25 by default, hard cap 50). Automatic mode also spaces sends 2–6 minutes apart, inside the recipient's business hours when their timezone is known.
- Form-only targets (LabelRadar, SubmitHub, web forms) are never emailed. Approving copies the text and opens the form for you.
- Opt-outs are permanent. A reply asking not to be contacted (detected in code and by Claude) adds the email and domain to a suppression list that survives "Delete everything".
- At most one follow-up per target, drafted for review, never auto-sent.
- If Claude Code or Gmail auth fails, everything pauses and a red bar explains why.
- Replies and web pages are treated as untrusted. The reply classifier runs with no tools, and nothing in an email can trigger a send.
- The server binds to 127.0.0.1 only, checks Host and Origin headers, and requires the session token from the launcher link.
- Offer screens say it plainly: Autoreach is not legal advice. Get contracts reviewed before signing.

## Develop

```bash
npm install
npm test            # 34 tests, uses a fake `claude` and an in-memory mailbox
npm run build       # builds the web app into dist/web
npm run demo        # demo server on :4748 with fake Claude + fake Gmail, data in $TMPDIR/autoreach-demo
```

Layout: `server/` (Fastify, SQLite, Claude runner, Gmail, scheduler), `web/` (React, Vite, Tailwind), `shared/` (types), `bin/autoreach.mjs` (launcher), `commands/autoreach.md` (slash command), `tests/` (vitest + `fake-claude.mjs`).

The visual design follows the "ledgerly" fintech template on 21st.dev: sage-cream ground, forest-green cards, moss primary, ember accent, Inter Tight with two-tone headlines, and a circuit-board backdrop.

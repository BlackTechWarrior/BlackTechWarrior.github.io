# p14m.com design doctrine

The site is a suite of interactive tools for digital logic and computer
architecture (K-maps, adders, caches, floating point, order books) with a
personal front page. Students arrive from search with a lab due; recruiters
arrive from a resume link. Both need the same thing: the tool or the fact,
readable in two seconds, with nothing between them and it.

This doctrine is the sibling of Breadmaxxer's (`DESIGN.md` there). It
borrows the grammar (one loud thing per screen, flat surfaces, roles not
values, sentence case, accent = action) and none of the palette.

## The four laws

| law | the rule |
|---|---|
| **uniform** | one value per role. Shape: card 24, well 16, field 12; buttons, chips, segments and nav items are pills. Surfaces are told apart by tone, not by borders: page `--bg`, cards `--surface`, wells `--well`, selection `--select`. Hairlines only separate rows. Every value in `shared.css` is a token; a page never types a hex. |
| **breathable** | spacing on 4·8·12·16·24·32·48·64; cards pad 32 (20 on phones), page gutters 48. A type role owns size, weight, leading, tracking, face and ink. A callsite picks a role, never a number. Text scales with the reader's browser font size (`body` is 100%), and no page scrolls sideways at 320px wide or at 200% text. |
| **mature** | the accent is the action colour. It appears on the single primary button of a surface, on focus rings, and under links. Data (K-map groups, tag/index/offset, bid/ask, sign/exponent/mantissa) uses the six `--d*` hues. State (hit/miss, error, warning) uses the three semantic tokens. Nothing decorative wears the accent. |
| **polished** | sentence case everywhere. No tracked uppercase labels, no numbered section markers, no middle-dot metadata strings, no arrows appended to buttons, no monospace for labels. Mono is for data and code only. Nothing moves on load; everything moves only in answer to an action. |

## Colour

Cool, near-neutral grounds (a hint of blue, never cream) and one warm
accent: amber, the colour of an indicator LED and of gold pads on a board.
Light and dark are both first-class; the page follows the system and the
toggle overrides it.

| role | light | dark | job |
|---|---|---|---|
| `--bg` | #F4F5F7 | #101214 | page ground |
| `--surface` | #FFFFFF | #17191D | panels, inputs |
| `--well` | #EAECEF | #20242A | inner wells, table heads, code |
| `--border` | #D5D9DF | #2B3038 | every hairline |
| `--ink` | #16181C | #E9EBEE | headings, values, body |
| `--ink-2` | #3D424A | #B9BEC6 | secondary body, labels |
| `--muted` | #5F6672 | #8B929C | captions, meta (the last legible step) |
| `--accent` | #E2A420 | #F2C14E | the one action fill |
| `--accent-ink` | #8A5F00 | #F2C14E | accent as text or ring on a ground |
| `--on-accent` | ink | bg | text on an accent fill |
| `--success` `--error` `--warn` | #1F7A3F #B93A3A #B04A12 | #5CC684 #EA8484 #F0914B | state |
| `--d1`…`--d6` | blue violet teal rose green clay | lighter tints | data identity |

Every text role clears 4.5:1 on `--bg`, `--surface` and `--well` in both
modes (checked computationally on 2026-09-22; re-check when a value moves).
Legacy names (`--paper`, `--rule`, `--mant`, …) are aliases in `shared.css`
so page-level CSS keeps working. New code uses the role names.

## Type

Two families, both self-hosted from `/fonts`:

- **Mona Sans** (variable, 200–900, width axis): display, headings, UI, body.
  Display roles sit at `font-stretch: 105%`. Numbers may be bold; text tops
  out at 600.
- **Monaspace Neon** (variable, 300–700): data and code. Tabular figures on.
  Never a label, never a heading, never a button.

| role | class | spec |
|---|---|---|
| display | `h1`, `.t-display` | 600, clamp(1.75rem → 2.5rem), lh 1.05, ls −0.02em, stretch 105% |
| headline | `h2`, `.t-headline` | 600, 1.375rem, lh 1.2, ls −0.01em |
| title | `h3`, `.t-title`, `.result-label` | 600, 0.9375rem, lh 1.3 |
| body | `body`, `.t-body` | 400, 1rem, lh 1.55 |
| lede | `.lede`, `.subtitle` | 400, 1.0625rem, ink-2 |
| label | `.lbl`, `.t-label` | 500, 0.8125rem, lh 1.3, ink-2, sentence case |
| meta | `.t-meta` | 400, 0.75rem, muted |
| data | `.t-data`, `.inp`, tables of values | mono 400/500, tabular |

## Layout

- **App shell.** A navigation drawer on the left (264px) lists every tool
  grouped by topic (Logic, Arithmetic, Memory, Markets), then Learn, About
  and the theme toggle. The current page is a tonal pill. Below 1024px the
  drawer hides behind a Menu button in a top bar and slides over the page.
  The markup comes from one template so every page lists the same links.
- Page order on a tool: h1 + one-sentence lede → "How it works" disclosure →
  the tool layout (controls card left, results right, one column below
  960px) → footer. Content is left-aligned beside the drawer, up to 1200px.
- The tool's own output (the K-map grid, the book, the diagram) is the hero:
  it gets the most room and the largest type on the page.
- Cards never nest. Inside a card, a well (`--well` ground, radius 16, no
  border) separates a sub-region. A bordered box inside a card is a defect.
- Rows are hairline-separated, never boxed. Four boxed panels in a stack
  means the hierarchy is gone: merge or flatten.
- Header: wordmark left, `Tools · Learn · About · theme` right, and on tool
  pages a scrollable strip of the nine tools with `aria-current="page"` on the
  current one. Links stay in the HTML so crawlers see them.
- Footer: every tool linked once (crawl path), the site links, the copyright.

## Controls

- Primary (`.btn-go`): accent pill, 44px tall, `--on-accent` text, 600,
  verb + object copy ("Generate map", "Compute sum"). One per surface.
- Toggles (`.btn-t`) are filter chips: hairline pill; on (`.on`) is a
  `--select` fill with a check mark. Segmented controls (`.mode-selector`)
  are a hairline pill split by dividers; the selected segment is a
  `--select` fill in 600 weight. Selected is never accent.
- Checkboxes and radios: 20px, 2px ink-2 outline, ink fill with a check when
  on. Sliders: 8px track filled in ink up to the value, a 6px bar handle.
- Inputs (`.inp`): surface fill, hairline, radius 12, 48px tall; focus turns
  the border accent-ink with no glow.
- New features carry a "New" pill through a date: `data-new-until` on the
  element, filled in by `lib/site.js`.
- Hover = a state layer (`--hover`); press = scale 0.97.
- Focus visible on keyboard: 2px accent-ink ring, 2px offset.

## Motion

Material easing: `--ease-out: cubic-bezier(0.2, 0, 0, 1)` for state changes,
`--ease-emph-decel: cubic-bezier(0.05, 0.7, 0.1, 1)` for things entering;
quick 160ms, smooth 280ms. Nothing moves on page load. Motion answers an
action: the drawer slides, a disclosure unfolds, a pressed control dips. No
staggered reveals, no fade-ups per section, no hover transforms on cards.
`prefers-reduced-motion` gets the settled state instantly.

## Copy

Sentence case. Plain verbs. Labels name the user's job ("Boolean
expression", "Don't-care terms"), not the system's. No em dashes in
user-facing copy; use a colon, comma or full stop. Errors say what happened
and what to do. Empty states say the next move ("Load a pattern to fill the
queue").

## SEO contract (every page)

`<title>` under 60 characters, name first; `meta description` 120–155
characters that says what the tool does; `link rel=canonical`; Open Graph
and Twitter card with `/og/<page>.png`; `theme-color` for both schemes;
JSON-LD (`WebApplication` for tools, `Person` + `WebSite` on the front page,
`LearningResource` on learn topics); one `h1`; landmarks (`header`, `nav`,
`main`, `footer`); a skip link. Learn topics are static pages under
`/learn/<id>/` so each is indexable; the hash router keeps working for
in-app navigation.

## Review-only rules (no grep can hold these)

- **Hierarchy**: read the page top to bottom and name each element's rung.
  Two adjacent elements on the same rung means one is wrong.
- **One focal point**: squint. If nothing wins, the surface has no hero.
- **Nothing moving** on first paint.
- **Re-art-direct at 400px**: a layout that merely wrapped is not designed.
- **Preserve character**: "too faint" means tune, never swap.
- **Say the label aloud** to someone doing the task.

## Do / don't

Do pull every value from a token. Do lead a tool with its controls and give its output the most room. Do
make the primary button say what will happen. Do check both themes and both
widths before calling a page done.

Don't frame a surface with a heavy border; use tone. Don't put a border on
a box inside a card. Don't use uppercase tracking, numbered eyebrows, middle dots, arrows
in buttons, gradient text, side-stripe borders, or a card grid of identical
boxes. Don't animate on scroll. Don't use the accent for data.

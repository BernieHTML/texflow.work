# ACSA Archive — Specification

## 1. Overview

A public academic paper archive for ACSA (Australian Crewed Spaceflight Agency),
living at **`texflow.work/ACSA/archive`** (lowercase `/acsa/archive` redirects to the
canonical path). It presents papers written by ACSA as clean, citation-friendly,
research-publication-style articles.

Papers are authored as **Markdown files** dropped into a `content/` folder. The
server parses YAML-style frontmatter for metadata, renders the Markdown body to
HTML, and serves both an archive landing page and individual paper pages — all using
the existing ACSA design language (space theme, Bebas Neue / DM Sans / Space Mono,
cyan/red/navy palette, starfield + custom cursor).

**Design goal:** scalable — adding a paper = dropping one `.md` file in the papers
folder. No code changes, no rebuild.

## 2. Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/ACSA/archive` (and `/ACSA/archive/`) | GET | Archive landing page (lists all papers) |
| `/ACSA/archive/:slug` | GET | Individual rendered paper page |
| `/acsa/archive`, `/acsa/archive/:slug` | GET | redirect → canonical `/ACSA/...` |
| `/api/acsa/papers` | GET | JSON list of paper metadata (scalability / reuse) |

The dynamic archive routes are registered **before** the existing
`app.use('/ACSA', express.static(...))` mount so server rendering wins. Static
assets (CSS/JS) live under `/ACSA/archive/assets/*` (two path segments), so they do
not collide with the single-segment `:slug` route and are served by the existing
static handler.

## 3. File architecture

```
content/acsa-papers/                  # drop-in Markdown papers (source of truth)
  aurora-capsule-thermal.md
  human-factors-microgravity.md
  ...
views/acsa-archive/
  landing.html                        # archive landing template
  paper.html                          # paper article template
public/ACSA/archive/assets/
  archive.css                         # shared archive + article styling (ACSA tokens)
  archive.js                          # reading progress, copy link, TOC, theme toggle, print
utils/archive/
  papers.js                           # load/parse/cache papers, frontmatter, readtime, TOC
  markdown.js                         # marked wrapper: heading IDs + TOC extraction
server.js                             # + archive routes (rendering + API)
scripts/seo-config.js                 # + /ACSA/archive landing SEO entry
docs/ACSA-ARCHIVE-SPEC.md             # this file
```

Templates are stored **outside** `public/` so they are never served raw; only the
server-rendered output is exposed.

## 4. Paper Markdown format

Each paper is a single `.md` file. The filename (minus `.md`) is the URL slug unless
overridden by a `slug:` field. Frontmatter is a `---` delimited block at the top:

```markdown
---
title: Thermal Management of the Aurora Crew Capsule
author: Dr. Jane Smith
affiliation: ACSA Thermal Systems Group
date: 2026-03-14
abstract: A short 1-3 sentence summary used on cards and meta description.
tags: [thermal, aurora, reentry]
doi: 10.1234/acsa.2026.001        # optional
pdf: /ACSA/archive/assets/papers/aurora-thermal.pdf  # optional real PDF; else print-to-PDF
hero: /ACSA/archive/assets/...      # optional OG/social image
---

## Introduction
Body content in standard Markdown (headings, lists, tables, code, blockquotes,
images, links, references)...
```

Required: `title`, `author`, `date`, `abstract`. Everything else optional with
sensible defaults. Read time is computed automatically (~200 wpm). Tags default to
`[]`.

## 5. Markdown rendering

- Use **`marked`** (installed) for robust Markdown -> HTML.
- Post-process headings (`h2`-`h4`) to inject stable `id` slugs and collect a
  **Table of Contents** tree.
- Sanitisation: papers are first-party trusted content authored by ACSA, but the
  renderer still escapes frontmatter values injected into HTML attributes/templates.
- Rendering happens **server-side at request time** with an in-memory cache keyed by
  file mtime, so new/edited files are picked up automatically without restart, while
  repeat requests are fast.

## 6. Archive landing page

- ACSA-branded header (logo -> back to `/ACSA/`, "Archive" wordmark, back-to-site link).
- Intro line describing the archive.
- Optional client-side filter/search box (by title/author/tag) — progressive
  enhancement; the full list is server-rendered for SEO and no-JS fallback.
- A responsive grid of **paper cards**, each showing:
  - Title, Author, Publication date (formatted), Short abstract, Read time, Tags.
- Cards link to `/ACSA/archive/:slug`.
- Empty state if no papers.

## 7. Paper article page

- Large title header (Bebas Neue display), subtitle/affiliation.
- Author information block + publication date + read time + tags + DOI (if present).
- **Table of contents** generated from headings (sticky on desktop, collapsible on
  mobile), with active-section highlighting.
- Academic article styling: comfortable measure (~70ch), readable body, styled
  headings, blockquotes, tables, figures/captions, code, and a references section.
- **Citation-friendly**: a "Cite this" block (APA-style) auto-generated from
  metadata, plus DOI link if present.
- **Toolbar** with:
  - PDF download button (links to real `pdf:` if provided, otherwise triggers a
    clean print-to-PDF via a dedicated `@media print` stylesheet).
  - Copy link button (copies canonical URL, shows confirmation).
  - Back to archive button.
- **Reading progress indicator** (fixed top bar that fills as you scroll the article).
- **Previous / Next paper** navigation (ordered by date, newest first).
- Responsive design (mobile-first), and a **light/dark reading toggle** (default dark
  to match ACSA; light "paper" mode for long-form reading), persisted in
  `localStorage`.

## 8. SEO

Per paper page, server-injected `<head>`:
- `<title>` = `{paper title} - ACSA Archive`
- `<meta name="description">` = abstract
- Canonical URL
- Open Graph (`og:type=article`, title, description, url, image, `article:author`,
  `article:published_time`, `article:tag`)
- Twitter card (summary_large_image)
- **JSON-LD `ScholarlyArticle`/`Article`** structured data (headline, author,
  datePublished, description, image, publisher=ACSA, mainEntityOfPage, keywords).

The landing page gets a standard SEO entry in `scripts/seo-config.js` (added to
sitemap). Paper pages are linked from the landing page for crawlability.

## 9. Styling

- Reuses ACSA CSS tokens (`--space`, `--navy`, `--red`, `--cyan`, etc.), fonts, the
  starfield canvas, and the custom cursor for brand consistency.
- Article body adopts a refined research-publication look: clear hierarchy, generous
  line height, small-caps/mono labels, hairline rules, accent links.
- Print stylesheet hides chrome (nav, toolbar, progress, cursor/stars) and renders a
  clean black-on-white academic document.

## 10. Scalability & maintenance

- Add a paper: drop `content/acsa-papers/my-paper.md`. It appears automatically on
  the landing page and gets its own URL.
- The papers loader scans the folder, parses frontmatter, sorts by date, and caches
  by mtime.
- No database; flat files keep it simple, version-controllable, and portable.

## 11. Non-goals (this iteration)

- User-uploaded papers / admin UI (papers are added via the repo).
- Server-side PDF generation engine (print-to-PDF covers the requirement; real PDFs
  can be attached via the `pdf:` field).
- Full-text server search (client-side filter on the landing page is provided).

## 12. Acceptance criteria

1. `/ACSA/archive` lists all papers with title, author, date, abstract, read time, tags.
2. `/ACSA/archive/:slug` renders a paper from Markdown with TOC, academic styling,
   responsive + dark/light, prev/next nav.
3. Toolbar provides PDF download, copy link, reading progress, back-to-archive.
4. SEO: title, description, OG, and Article JSON-LD present per paper.
5. Dropping a new `.md` into `content/acsa-papers/` makes a new paper appear with no
   code changes.
6. Existing ACSA site and all other routes remain unaffected.

# texflow.work

A static site. Every page here is files in a browser — there is no server, no
database and no account. Whatever you type into a Flow stays on your device.

It is published with GitHub Pages from the root of this branch, and answers at
two addresses: `https://berniehtml.github.io/texflow.work/` while the domain is
still being moved, and `https://texflow.work` once the DNS points here. Nothing
in the published files assumes either one — see **Paths** below.

## What is here

| Path | What it is |
| --- | --- |
| `/` | Holding page: the wordmark and a rotating Moon, drawn in a canvas at load. |
| `/products` | The index of everything live. |
| `/flows/` | Catalogue of the twenty Flows. |
| `/f/<id>/` | One Flow. A single self-contained HTML file plus its icons, manifest and service worker. |
| `/psrmap` | Lunar south pole permanently-shadowed-region map. |
| `/ltec-system` | Interactive Lunar Thermal Energy Conversion model (`/ltec-system/qr` is its QR card). |
| `/ACSA/` | Australian Crewed Spaceflight Agency pages. |
| `/ACSA/archive` | Paper archive, prerendered from Markdown. |
| `/science` | Interactive space and flight lessons. |
| `/minibridge/` | MiniBridge. |
| `/revision`, `/wave`, `/lily` | Unlisted one-off pages, kept reachable by direct link. |
| `/privacy-policy`, `/terms-and-conditions` | Legal pages. |
| `/_src/` | Build inputs. Not a published page, though Pages will serve it as files. |

## Building

```
npm install          # only to get `marked`, for the archive
npm run build        # flows:build + archive:build
```

- `npm run flows:build` compiles `_src/flows/` into `/f/`, fills the grid in
  `flows/index.html`, and rewrites the Flow block in `sitemap.xml`. **Nothing in
  `/f/` should be edited by hand** — it is all generated.
- `npm run archive:build` renders `_src/archive/papers/*.md` into
  `/ACSA/archive/`. Re-run it after adding or changing a paper.
- `npm run flows:check` opens each built Flow in a headless browser, if one is
  available, and checks it works.

## Paths

Every `href`, `src`, `url()` and manifest entry in the published files is
**relative**. A leading `/` would mean the server root, which on a Pages project
site is the user site rather than this project, so the same link cannot be
absolute and work at both addresses.

Two consequences worth knowing:

- Extensionless URLs are directories. `/privacy-policy` is
  `privacy-policy/index.html`, because Pages has no rewrite rules to map a bare
  path onto a `.html` file.
- `404.html` is the one exception. Pages serves it for any unknown path, so the
  address in the bar is not where the file sits and relative links would resolve
  against the wrong directory. It works its site root out in script instead.

`.nojekyll` is required: without it Pages runs Jekyll, which drops every path
beginning with `.` or `_` — taking `.well-known/` and `_src/` with it.

## Moving the domain

When DNS is ready, add a `CNAME` file containing `texflow.work` and set the
custom domain in the repository's Pages settings. It is deliberately absent for
now: with it in place, the `github.io` address redirects to `texflow.work`,
which would be unreachable until the DNS change has propagated.

## What used to be here

This site ran on a VPS under Express, and about half of it was server-side:
smig, BMFlight, TexMKT, Vyex, LEOSpy, Platform66, TEX, Ellipse, TexoStat,
TexLetter, TexSkills, Gander and GanderChat all needed accounts, Stripe, stored
data or credentialed upstream feeds, and none of them can be static. They were
removed rather than left to fail in a browser. Every file is still in this
repository's history on `texflow-dev-1` and on the per-app branches.

Two things that survived lost a feature each, and say so in place:

- Sharing a Flow used to mint a server-side copy at `/s/<code>/` so the
  recipient's Delete could never touch the sender's. A share now sends the
  catalogue link, and the copy is made in the recipient's own browser when they
  open it — which is where the data always lived.
- The ACSA support form posted to an endpoint that kept a public roll of
  supporters. It now hands the same details to the visitor's mail client, which
  is what the contact form on that page already did.

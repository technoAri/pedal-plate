# Pedal Plate

**Home Food. On The Move.** — https://pedalplate.in

Landing page for Pedal Plate — home-style food, cooked fresh and pedaled straight to your street in Burdwan, West Bengal.

## Structure

```
index.html                  Single-page site (inline CSS + JS, Poppins via Google Fonts)
images/                     Hero, logo, favicons and app icons
site.webmanifest            PWA manifest (name, icons, theme colour)
robots.txt, sitemap.xml     Crawler directives + sitemap for SEO
vercel.json                 Vercel config (clean URLs, caching + security headers)
scripts/check-site.sh       Pre-deploy checks (HTML structure, missing assets)
.github/workflows/vercel.yml  CI/CD pipeline
```

## Run locally

```bash
python3 -m http.server 8000     # then open http://localhost:8000
./scripts/check-site.sh         # same checks CI runs
```

## CI/CD (GitHub Actions → Vercel)

| Event | What happens |
|---|---|
| Push to `main` | Checks → **production** deploy (pedalplate.in) |
| Push to any other branch | Checks → **preview** deploy (URL in the run summary) |
| Pull request | Checks only |

### One-time setup

1. **Link the project** (on your machine, in this repo):
   ```bash
   npm i -g vercel
   vercel link          # pick the existing Pedal Plate project
   cat .vercel/project.json   # shows orgId and projectId
   ```
2. **Create a token** at https://vercel.com/account/tokens.
3. **Add repo secrets** — GitHub → Settings → Secrets and variables → Actions:
   - `VERCEL_TOKEN` — the token from step 2
   - `VERCEL_ORG_ID` — `orgId` from `.vercel/project.json`
   - `VERCEL_PROJECT_ID` — `projectId` from `.vercel/project.json`
4. **Avoid double deploys:** if the Vercel project is also connected to this repo via Vercel's Git integration, either disconnect it (Vercel → Project → Settings → Git) or remove this workflow's deploy job — use one or the other.

## Design & performance notes

- Brand font Poppins only (Bold/ExtraBold headings, Regular/Medium body, SemiBold buttons) with `display=optional`, so text never reflows after first paint (CLS 0).
- All motion is CSS `transform`/`opacity`, paused off-screen, and disabled under `prefers-reduced-motion`.
- Hero image is preloaded with `fetchpriority="high"` and has explicit dimensions; all graphics are inline SVG (no extra requests).
- Structured data: `FoodEstablishment` + `Menu` (JSON-LD), Open Graph and Twitter cards.

## Notes

- The "Pedal Partner" form has no backend yet; it opens a pre-filled email. Swap in a real endpoint (Formspree, Google Sheet, etc.) when ready.

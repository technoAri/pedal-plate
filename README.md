# Pedal Plate

**Home Food. On The Move.** — https://pedalplate.in

Landing page for Pedal Plate — home-style food, cooked fresh and pedaled straight to your street in Burdwan, West Bengal.

## Structure

```
404.html                    Branded "page not found" page
card.html                   /card: link page opened by the visiting-card QR code
pedal-plate.vcf             "Save contact" file used on /card
index.html                  Single-page site (inline CSS + JS, Poppins via Google Fonts)
images/                     Hero, logo, favicons and app icons
site.webmanifest            PWA manifest (name, icons, theme colour)
robots.txt, sitemap.xml     Crawler directives + sitemap for SEO
vercel.json                 Vercel config (clean URLs, caching + security headers)
scripts/check-site.sh       Pre-deploy checks (HTML structure, missing assets)
.github/workflows/checks.yml  Site checks on every push/PR
```

## Run locally

```bash
python3 -m http.server 8000     # then open http://localhost:8000
./scripts/check-site.sh         # same checks CI runs
```

## Deployment (Vercel)

The Vercel project is connected to this repo through Vercel's GitHub integration:

| Event | What happens |
|---|---|
| Push to `main` | **Production** deploy to pedalplate.in |
| Push to any other branch | **Preview** deploy (private URL from Vercel) |

GitHub Actions (`.github/workflows/checks.yml`) runs `scripts/check-site.sh` on every push and PR to catch broken asset references.

Vercel project settings: Framework Preset **Other**, no build command, output directory = repo root, production branch `main`.

## Design & performance notes

- Brand font Poppins only (Bold/ExtraBold headings, Regular/Medium body, SemiBold buttons) with `display=optional`, so text never reflows after first paint (CLS 0).
- All motion is CSS `transform`/`opacity`, paused off-screen, and disabled under `prefers-reduced-motion`.
- Hero image is preloaded with `fetchpriority="high"` and has explicit dimensions; all graphics are inline SVG (no extra requests).
- Structured data: `FoodEstablishment` + `Menu` (JSON-LD), Open Graph and Twitter cards.

## Notes

- The "Pedal Partner" form has no backend yet; it opens a pre-filled email. Swap in a real endpoint (Formspree, Google Sheet, etc.) when ready.

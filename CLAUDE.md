# Pedal Plate — brand guide

Follow these for every change to the site. Ask before deviating.

## Colour palette (corrected — the only approved palette)

| Token | Hex | Role |
|---|---|---|
| Deep turmeric | `#96601A` | **Primary.** Buttons, highlights, prices, large accent panels. Passes contrast on cream and with white/cream text. |
| Basil green | `#3F7D4A` | **Secondary.** Health and freshness: menu day tags, fresh-made badges. |
| Warm cream | `#FBF6EC` | Background. |
| Charcoal ink | `#2B2620` | Text, logo, dark sections. |
| Chili red | `#C0392B` | **Accent only.** Today's special, sold-out flags. Under 10% of any design, **never next to basil green.** |

- Do **not** use bright turmeric gold `#E8A33D` (superseded; too close to Swiggy orange, fails contrast).
- Lighter or darker tints of the five colours are fine for soft backgrounds (e.g. pale turmeric tint, turmeric tint `#E3AD57` for text on charcoal). Never introduce new hues.

## Typography

- **Poppins only** (one family), self-hosted in `fonts/` (latin + latin-ext for ₹), `font-display: optional`. Don't add Google Fonts links.
- Headings: Poppins Bold / ExtraBold
- Body: Poppins Regular / Medium
- Buttons: Poppins SemiBold
- Overall feel: warm, modern, friendly — not corporate or premium-luxury.

## Copy

- Use "combo", not "thali". Don't use "ghar ka khana".
- **One brand tagline only: "Home Food. On The Move."** Do not add other taglines or slogans.
- Position as a **mobile QSR** (quick-service restaurant) on cycle carts. Brand copy is location-neutral (launched in Burdwan, but the brand is not Burdwan-specific).
- Meal-gifting programme: label "Share a Plate", headline "Gift a meal to someone who needs it.", button "Pedal it forward".
- Visual motif: green and turmeric leaves, soft waves (from the brand banner).

- Business contact: phone +91 76991 49899 (calls and WhatsApp orders), email pedalplate.food@gmail.com, Instagram @pedalplate.in.
- Visiting card QR points to https://pedalplate.in/card (card.html). Keep that URL working; printed cards depend on it.

## Working with the owner

- **Show a visual preview before any code or design change**, and wait for an OK. Explain trade-offs briefly, with a recommendation.
- **Never redraw, trace or "clean up" the logo.** Use the supplied logo files as they are. Logo text colours: "Pedal" `#1B3E1E`, "Plate" `#96601A`.
- Never change the font, palette or copy rules on your own. If something seems to need it, ask first.
- Lighthouse before and after every site change: mobile 96 / desktop 100, CLS 0, and no extra first-load weight. A change must not lower these.

## Photos on the site ("From the Streets", `#streets`)

- Process every photo with `scripts/process-photo.sh`: 4:5 crop, a subtle warm grade (never cool or heavy filters), metadata stripped, WebP quality 70 at 400/720/1080w in `images/streets/`.
- In markup: `srcset` + `sizes`, `loading="lazy"`, `decoding="async"`, `width`/`height`, descriptive `alt`, short caption (no slogans).
- **Blur payment QR codes** (UPI codes show the owner's name and ID) before publishing. Check that customers who can be recognised are OK being shown, and only show children from behind.
- Keep phone originals and videos out of the repo. Videos go on Instagram, and the site links to them.
- The physical cart wrap carries extra slogans ("Good Food Happier People", "Freshly Cooked…"). Don't repeat them in copy, and don't choose shots where they dominate.

## Print (cards, posters, menus)

- Visiting card: 3.5 x 2 in + 0.125 in bleed, 600 dpi PNG + PDF, keep text 0.125 in inside the trim, minimum 6 pt text.
- One QR per card, at least 20 mm, with a quiet zone of 4 modules, pointing to https://pedalplate.in/card. Scan-test every export.
- Company card = brand-led (bulk printing for the carts). A personal (co-founder) card puts the name at 11-12 pt Bold, not ExtraBold, so the name doesn't overpower the phone number and QR.
- Bengali text in print uses Hind Siliguri (Poppins has no Bengali glyphs). The website stays Poppins-only.

## Engineering

- Static site: `index.html` + `images/`. Run `./scripts/check-site.sh` before committing.
- Keep Core Web Vitals: animate only `transform`/`opacity`, respect `prefers-reduced-motion`, give images explicit `width`/`height`.
- Images: serve WebP; large images get `srcset` sizes (see `images/hero-*.webp`). Keep `hero.jpg` and `logo.png` only for social previews and structured data.
- **Never push to GitHub (any branch) or update the preview artifact without the owner's explicit approval.** `main` deploys straight to pedalplate.in.

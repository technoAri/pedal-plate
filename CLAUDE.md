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

- Business contact: phone +91 76991 49899, email pedalplate.food@gmail.com, Instagram @pedalplate.in.
- Visiting card QR points to https://pedalplate.in/card (card.html). Keep that URL working; printed cards depend on it.

## Engineering

- Static site: `index.html` + `images/`. Run `./scripts/check-site.sh` before committing.
- Keep Core Web Vitals: animate only `transform`/`opacity`, respect `prefers-reduced-motion`, give images explicit `width`/`height`.
- Images: serve WebP; large images get `srcset` sizes (see `images/hero-*.webp`). Keep `hero.jpg` and `logo.png` only for social previews and structured data.
- **Never push to GitHub (any branch) or update the preview artifact without the owner's explicit approval.** `main` deploys straight to pedalplate.in.

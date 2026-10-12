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

- **Poppins only** (one family). Google Fonts, `display=optional`.
- Headings: Poppins Bold / ExtraBold
- Body: Poppins Regular / Medium
- Buttons: Poppins SemiBold
- Overall feel: warm, modern, friendly — not corporate or premium-luxury.

## Copy

- Use "combo", not "thali". Don't use "ghar ka khana".
- Brand taglines: "Home Food. On The Move.", "Good Food. Happier People.", "Freshly Cooked. Thoughtfully Served. For a Better Tomorrow.", "Local Food. Local People. Stronger Tomorrows.", "Good Food. Brighter Days.", "Let's take good food further."
- Visual motif: green and turmeric leaves, soft waves (from the brand banner).

## Engineering

- Static site: `index.html` + `images/`. Run `./scripts/check-site.sh` before committing.
- Keep Core Web Vitals: animate only `transform`/`opacity`, respect `prefers-reduced-motion`, give images explicit `width`/`height`.

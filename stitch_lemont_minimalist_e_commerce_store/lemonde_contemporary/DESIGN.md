---
name: Lemonde Contemporary
colors:
  surface: '#f9f9f9'
  surface-dim: '#dadada'
  surface-bright: '#f9f9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f3'
  surface-container: '#eeeeee'
  surface-container-high: '#e8e8e8'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1a1c1c'
  on-surface-variant: '#444748'
  inverse-surface: '#2f3131'
  inverse-on-surface: '#f1f1f1'
  outline: '#747878'
  outline-variant: '#c4c7c8'
  surface-tint: '#5d5f5f'
  primary: '#5d5f5f'
  on-primary: '#ffffff'
  primary-container: '#ffffff'
  on-primary-container: '#747676'
  inverse-primary: '#c6c6c7'
  secondary: '#5e5e5e'
  on-secondary: '#ffffff'
  secondary-container: '#e2e2e2'
  on-secondary-container: '#646464'
  tertiary: '#5d5f5f'
  on-tertiary: '#ffffff'
  tertiary-container: '#ffffff'
  on-tertiary-container: '#747676'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2e2e2'
  primary-fixed-dim: '#c6c6c7'
  on-primary-fixed: '#1a1c1c'
  on-primary-fixed-variant: '#454747'
  secondary-fixed: '#e2e2e2'
  secondary-fixed-dim: '#c6c6c6'
  on-secondary-fixed: '#1b1b1b'
  on-secondary-fixed-variant: '#474747'
  tertiary-fixed: '#e2e2e2'
  tertiary-fixed-dim: '#c6c6c7'
  on-tertiary-fixed: '#1a1c1c'
  on-tertiary-fixed-variant: '#454747'
  background: '#f9f9f9'
  on-background: '#1a1c1c'
  surface-variant: '#e2e2e2'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 64px
    fontWeight: '600'
    lineHeight: '1.1'
    letterSpacing: 0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '500'
    lineHeight: '1.2'
    letterSpacing: 0.02em
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '500'
    lineHeight: '1.2'
    letterSpacing: 0.02em
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: 0.01em
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: 0.01em
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.1em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 64px
  section-gap: 120px
---

## Brand & Style

The design system is rooted in **Minimalism** with a focus on editorial prestige. It targets a discerning audience that values clarity, modern aesthetics, and high-quality craftsmanship. The emotional response should be one of "quiet luxury"—calm, spacious, and deliberate.

The UI avoids all unnecessary decorative elements, relying instead on heavy whitespace, rigorous grid alignment, and exceptional typography to communicate value. There are no gradients or complex textures; the focus remains entirely on the photography of the garments.

## Colors

The palette is strictly monochromatic with a singular, deliberate accent. 

- **Primary (White):** Used for the global canvas and primary surface areas to maximize light.
- **Secondary (Black):** Used for all primary text, iconography, and structural borders.
- **Accent (Coral Pink):** Reserved exclusively for small, high-intent callouts such as a "New" tag, a tiny notification dot, or a subtle hover state on a text link. It should never dominate the composition.
- **Neutral (Light Gray):** Applied to secondary containers or subtle section breaks to provide soft depth without introducing weight.

## Typography

This design system utilizes a high-contrast typographic hierarchy to guide the user's eye. **Hanken Grotesk** provides a sharp, contemporary edge for headlines, while **Inter** ensures maximum legibility for product descriptions and functional UI. 

Key attributes include:
- **Increased Letter Spacing:** Applied to all levels to enhance the premium, breathable feel.
- **Label Caps:** Used for tags, categories, and small navigational elements to create a distinct visual rhythm.
- **Black on White:** Strict adherence to high-contrast text for an editorial look.

## Layout & Spacing

The layout follows a **Fixed Grid** philosophy on desktop (12 columns) and a **Fluid Grid** on mobile (4 columns). 

- **Whitespace:** Use extremely generous vertical padding between sections (120px+) to allow the products to "breathe."
- **Alignment:** All text should follow a strict baseline grid.
- **Margins:** Desktop margins are intentionally wide (64px) to frame the content like a high-end lookbook. 
- **Reflow:** On mobile, product grids should transition from 3 or 4 columns to 1 or 2, maintaining a focus on high-resolution imagery.

## Elevation & Depth

This design system avoids traditional shadows to maintain a flat, modernist aesthetic. Depth is achieved through:

- **Tonal Layering:** Using the Light Gray (#F5F5F5) for secondary containers (like a shopping bag sidebar or a search overlay) against the White (#FFFFFF) background.
- **Keyline Borders:** 1px solid Black (#000000) or 1px Light Gray (#F5F5F5) borders define structure without adding visual bulk.
- **Opacity:** Use subtle transparency (e.g., 90% White) for sticky headers to allow imagery to peek through as the user scrolls.

## Shapes

The shape language is predominantly **Sharp**. A very subtle 4px radius (Soft) is applied to buttons and input fields to prevent the UI from feeling overly aggressive, but large containers and image modules should maintain 0px sharp corners to reinforce the architectural, premium feel.

## Components

- **Product Cards:** Minimalist blocks consisting of a full-width image, followed by a `label-caps` category, a `body-md` product name, and a `body-md` price. No borders around cards; use white space for separation.
- **Buttons:** 
  - **Primary:** Solid black background, white text, no border. 
  - **Secondary:** Transparent background, 1px black border, black text.
  - **Hover:** Primary buttons shift to 80% opacity; secondary buttons fill with a light gray tint.
- **Input Fields:** 1px light gray bottom-border only (underline style) or a full 1px border. Focus state is a 1px black border.
- **Chips/Tags:** Small `label-caps` text. For "New" or "Sale," use a tiny Coral Pink (#F88379) dot next to the text.
- **Navigation:** Text-only in `label-caps`. Avoid icons unless strictly necessary (e.g., search, bag). Icons should be 1px weight line icons.
- **Footer:** Minimalist rows of text links in `body-md` with a subtle gray background (#F5F5F5).
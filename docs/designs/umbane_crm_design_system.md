---
name: "Umbane Grid Precision"
description: "A clean, high-trust enterprise SaaS design system for Umbane CRM, uniting crisp white operational surfaces with deep navy authority, electric blue interactivity, and subtle volt-yellow energy highlights."
---

## Overview

Umbane Grid Precision is built for utility operations managers, customer service leads, and field coordinators who manage electricity meters, property portfolios, and customer accounts every day. The interface feels calm, structured, and dependable — pairing generous white space with crisp typographic hierarchy so complex utility workflows never feel cluttered.

The visual language follows a **Corporate / Modern** direction: flat, clean white canvases anchored by deep navy blue (`#174EA6`), energized by electric blue interactive states (`#2563EB`), and punctuated sparingly by volt-yellow (`#F5B700`) status highlights and electrical motifs.

## Colors

The palette pairs a clean white operational canvas with deep navy brand authority and electric blue interactive accents. Volt yellow (`#F5B700`) is reserved for subtle brand highlights, energy-flow accents, and active indicators — never as a large text-heavy background without dark ink contrast.

- **Brand & Accent:** `umbane-navy` (`#174EA6`) anchors primary actions and brand marks; `electric-blue` (`#2563EB`) drives focus rings, links, and active states; `volt-yellow` (`#F5B700`) provides subtle energy highlights.
- **Surfaces:** Clean `#FFFFFF` primary background and card surfaces, stepped subtly with cool-tinted neutral containers (`#F8FAFF`, `#F1F5FD`) for secondary panels and input wells.
- **Status:** Semantic `success`, `warning`, and `error` tokens are reserved strictly for system feedback and validation states.

```yaml
colors:
  umbane-navy: "#174EA6"
  electric-blue: "#2563EB"
  volt-yellow: "#F5B700"
  on-volt: "#261A00"
  primary: "#174EA6"
  on-primary: "#FFFFFF"
  primary-hover: "#003781"
  primary-container: "#EDF0FF"
  on-primary-container: "#001944"
  secondary: "#2563EB"
  on-secondary: "#FFFFFF"
  secondary-container: "#DBE1FF"
  on-secondary-container: "#002A78"
  tertiary: "#F5B700"
  on-tertiary: "#261A00"
  tertiary-container: "#FFEFD5"
  on-tertiary-container: "#402D00"
  background: "#FFFFFF"
  on-background: "#1A1B21"
  surface: "#FFFFFF"
  surface-container-lowest: "#FFFFFF"
  surface-container-low: "#F8FAFF"
  surface-container: "#F1F5FD"
  surface-container-high: "#E8EEF9"
  on-surface: "#1A1B21"
  on-surface-variant: "#434752"
  outline: "#737783"
  outline-variant: "#D5DCEB"
  success: "#15803D"
  on-success: "#FFFFFF"
  error: "#BA1A1A"
  on-error: "#FFFFFF"
  error-container: "#FFDAD6"
  on-error-container: "#93000A"
```

## Typography

Umbane CRM uses **Inter** across all display, heading, body, and label roles for crisp legibility at both dashboard density and authentication scale, paired with **JetBrains Mono** for meter serial numbers, account IDs, and technical codes.

```yaml
typography:
  display-lg:
    fontFamily: "Inter"
    fontSize: 44px
    fontWeight: 700
    lineHeight: 52px
    letterSpacing: -0.9px
  display-lg-mobile:
    fontFamily: "Inter"
    fontSize: 32px
    fontWeight: 700
    lineHeight: 38px
    letterSpacing: -0.6px
  headline-lg:
    fontFamily: "Inter"
    fontSize: 34px
    fontWeight: 700
    lineHeight: 42px
    letterSpacing: -0.6px
  headline-lg-mobile:
    fontFamily: "Inter"
    fontSize: 28px
    fontWeight: 700
    lineHeight: 34px
    letterSpacing: -0.4px
  headline-md:
    fontFamily: "Inter"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 32px
    letterSpacing: -0.3px
  title-lg:
    fontFamily: "Inter"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 28px
    letterSpacing: -0.2px
  title-md:
    fontFamily: "Inter"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 24px
    letterSpacing: -0.1px
  body-lg:
    fontFamily: "Inter"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 26px
    letterSpacing: 0px
  body-md:
    fontFamily: "Inter"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 22px
    letterSpacing: 0px
  label-lg:
    fontFamily: "Inter"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 20px
    letterSpacing: 0px
  label-md:
    fontFamily: "Inter"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 18px
    letterSpacing: 0px
  label-sm:
    fontFamily: "Inter"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0.1px
  mono-sm:
    fontFamily: "JetBrains Mono"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0px
```

## Layout & Spacing

The layout uses a **Fixed-Max-Width 12-Column Grid** (`max-w-7xl`, 1280px) on desktop viewports with generous 24px–32px gutters, collapsing gracefully to a single-column fluid stack with 16px–24px page margins on tablet and mobile viewports. Spacing adheres strictly to a 4px/8px grid.

```yaml
spacing:
  gutter-xs: 4px
  gutter-sm: 8px
  gutter-md: 16px
  gutter-lg: 24px
  gutter-xl: 32px
  section: 48px
  page-margin: 32px
```

## Elevation & Depth

Hierarchy is established through clean white surfaces, subtle `1px` `outline-variant` borders, and soft ambient navy-tinted shadows (`0 12px 32px -8px rgba(23, 78, 166, 0.08)`) on elevated cards such as the login card. Avoid heavy drop shadows or dark-mode glow effects.

## Shapes

Umbane CRM uses approachable, modern rounded geometry: `10px–12px` (`md`) on input fields and buttons, `16px–20px` (`lg`/`xl`) on primary cards, and `4px` (`sm`) on checkboxes.

```yaml
rounded:
  sm: 4px
  DEFAULT: 8px
  md: 12px
  lg: 16px
  xl: 20px
  full: 9999px
```

## Motion & Micro-interaction

Interactions feel crisp, immediate, and reliable. Hover and focus transitions resolve in `120ms`, while card or panel reveals settle in `220ms` with a smooth ease-out curve.

```yaml
motion:
  state-change:
    duration: 120ms
    delay: 0ms
    timingFunction: ease-out
  surface-enter:
    duration: 220ms
    delay: 0ms
    timingFunction: cubic-bezier(0.2, 0, 0, 1)
```

## Voice & Content Strategy

- **Tone of voice:** Clear, confident, and operational. Speak directly to utility and property managers without hype or filler.
- **Capitalisation:** Sentence case for descriptions, form labels, and links; concise Title Case for primary action buttons (`Sign In`, `Create Account`) and brand headings.
- **Button and action labels:** Action-oriented and unambiguous (`Sign In`, `Reset Password`, `Create Account`).
- **Numbers & units:** Tabular figures for meter counts, kWh readings, and timestamps.

## Components

Component implementations live as individual HTML sticker sheet files in
`components/`. Each file contains the canonical, styled HTML components with
`<!-- COMPONENT: name -->` comment markers. Read each file before use.

- **Button** → `@components/button.html`: `button-primary`, `button-icon`, `button-with-icon`
- **Card** → `@components/card.html`: `card-elevated`, `card-action`, `card-interactive`, `card-interactive-2`
- **Checkbox** → `@components/checkbox.html`: `checkbox-standard`, `checkbox-group`
- **Input Field** → `@components/input-field.html`: `input-field-text`, `input-field-icon`
- **Typography** → `@components/typography.html`: `typography-display`, `typography-body`, `typography-label`

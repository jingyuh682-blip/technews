# TechNews Calm Graphite Theme Design

Date: 2026-08-31
Scope: visual theme recalibration for /technews only.

## Goal

Reduce visual fatigue during prolonged reading while preserving the existing dashboard layout, routes, content sources, keyboard behavior, and refresh controls.

## Design Read

This is a high-density technology intelligence dashboard for frequent scanning. It remains a redesign-preserve change: the current four-column cockpit layout stays intact, while its black-and-gold terminal palette is replaced with a calmer graphite and mist-blue foundation.

## Chosen Approach

Use a single accent color with semantic variables in a new stylesheet loaded after the current stylesheet.

- Foundation: blue graphite surfaces with lower contrast between adjacent panels.
- Text: off-white primary copy and blue-gray secondary copy, avoiding low-contrast brown text.
- Accent: restrained jade-green for links, active controls, progress, and focus states.
- Separation: cool-gray hairlines and subtle tinted shadows instead of amber borders and glow.
- Texture: remove the full-page grain layer to reduce visual noise.

## Color Tokens

| Token | Value | Use |
| --- | --- | --- |
| void | #151B20 | page and header background |
| void-2 | #1B242B | header and section heading background |
| panel | #202A31 | main panel surface |
| panel-2 | #27343C | raised panel surface |
| ink | #E8F0F2 | primary text |
| ink-soft | #B8C7CC | supporting text |
| muted | #84979F | metadata |
| line | rgba(151, 177, 185, 0.16) | standard separators |
| line-strong | rgba(151, 177, 185, 0.28) | strong separators |
| accent | #4FA88C | links and primary actions |
| accent-dim | rgba(79, 168, 140, 0.12) | hover and selected backgrounds |
| danger | #D98072 | destructive actions |

## Implementation Boundary

1. Add public/theme-calm-graphite.css and load it after public/styles.css.
2. Override only visual tokens and selectors with hard-coded amber or near-black colors.
3. Do not alter HTML structure, API endpoints, scripts, service configuration, URL paths, or content copy.
4. Keep the current responsive dashboard behavior untouched.
5. Stage and commit only the new theme file and its stylesheet reference. Existing uncommitted server changes remain unstaged.

## Validation

- Load http://39.96.71.50/technews/ and confirm all panels render.
- Check console errors and primary controls.
- Check desktop layout and a narrow viewport.
- Verify readable button, metadata, and link contrast.
- Confirm git status shows unrelated changes still unstaged.
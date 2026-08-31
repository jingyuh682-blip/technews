# TechNews Editorial Grid Rebalance Design

Date: 2026-08-31
Scope: rebalance the TechNews desktop dashboard grid at `/technews/`.

## Goal

Group related scanning tasks into vertical columns while making the word-cloud and reading-insight rail slightly narrower.

## Approved Layout

```text
[ word cloud    ][ technology news ][ technology hot ][ GitHub high stars ]
[ reading notes ][ paper hot       ][ technology hot ][ weekly risers     ]
```

## Grid Contract

- The grid keeps four columns and two rows.
- Column 1 uses `0.86fr` for the word cloud and reading-insight rail.
- Columns 2 through 4 use `1.08fr` for equivalent reading space.
- `pane-news` and `pane-papers` share column 2 from top to bottom.
- `pane-hot` occupies column 3 across both rows.
- `pane-ghs` and `pane-ghr` share column 4 from top to bottom.
- `pane-cloud` and `pane-books` remain in column 1 from top to bottom.

## Implementation Boundary

1. Change only the `.dash-wrap` `grid-template-columns` and `grid-template-areas` declarations in `public/styles.css`.
2. Preserve existing `.pane-*` area identifiers, component markup, content feeds, routes, keyboard behavior, and the loading layout.
3. Do not alter the existing static theme stylesheet, JavaScript, server configuration, or Nginx configuration.
4. Add a static test that verifies the exact approved CSS grid arrangement.
5. Stage and commit only the layout CSS hunk, its test, and this design and plan documentation. Existing server modifications remain unstaged.

## Validation

- Run the new grid contract test with Node's built-in test runner.
- Load the deployed desktop page and verify the four requested columns visually.
- Check browser console errors after reload.
- Confirm the staged diff contains only the new layout work before committing and pushing from Alibaba Cloud.
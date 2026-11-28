# Voidsmith sidebar dock (contract v1)

Voidsmith userscripts share one stack of rows on Torn's left sidebar. ReviveRelay sits at the top, and every other
script goes directly underneath it in priority order. When ReviveRelay is not installed, the first script takes its slot.

## Entry

- One host element per script, as a **direct child** of the sidebar.
- `id="voidsmith-dock-<id>"`, `data-voidsmith-dock="<id>"`, `data-voidsmith-dock-priority="<n>"`.
- Content lives in a shadow root and mirrors ReviveRelay's row: `margin:4px 0`, `min-height:28px`, 1px border,
  `border-radius:5px`, bold 12px Arial, icon + label (`white-space:nowrap; text-overflow:ellipsis`).
  Tokens: dark `#2e2e2e` background / `#444` border / `#fa6a6f` accent; light `#f2f2f2` / `#ccc` / `#a4161a`.
  The theme comes from `body.dark-mode` / `body.light-mode`, else `prefers-color-scheme`.
- The row's button carries `aria-expanded` reflecting whether the script's panel is open.

## Priorities

| id | priority |
| --- | --- |
| ReviveRelay (`#reviverelay-lite-root`, no attributes needed) | 10 |
| `recruitment-agency` | 20 |
| `property-rental-manager` | 30 |
| `company-training-manager` | 40 |

A missing or non-numeric priority counts as 1000. Equal priorities are ordered by dock id (ascending).

## Sidebar lookup

The first match of: `#sidebar`, `#sidebarroot`, `nav[aria-label="Primary"]`, `nav[aria-label="Main"]`,
`[role="navigation"][class*="sidebar"]`, `[class*="sidebar"] nav`. This is the same list ReviveRelay 1.0.5 uses.

## Placement (idempotent, moves only your own host)

Look at the sidebar's other children, leaving out your own host. Entries are elements with `data-voidsmith-dock`,
plus `#reviverelay-lite-root`. Everything else is a native block.

1. If any entry ranks at or below you, insert directly after the last such entry.
2. Otherwise, insert before the first entry that ranks above you.
3. Otherwise (you are the only entry), insert before the 2nd native block. If there is only one native block, insert
   before it; if there are none, append. This is the slot ReviveRelay uses.

Only call `insertBefore` when the host's parent or its `nextElementSibling` differs from the computed position. Never
move other scripts' entries. When a script mounts, it removes stale copies of its own id.

ReviveRelay 1.0.5 counts dock entries as native blocks and only re-places itself when its parent changes. The rules
above still keep it above every entry: it inserts before the 2nd non-RR child, and that child is the first entry.

## Re-attach

- Use a `MutationObserver` with `childList` (no `subtree`) on the sidebar and on its parent, so you notice when Torn
  replaces `#sidebar`. Coalesce callbacks to one placement per microtask.
- Use no timers and no polling. Never put a subtree observer on `document` or `body` for the dock.
- Before the sidebar exists, Recruitment Agency retries from its existing body child-list and header watchers.
  `#sidebarroot` is itself a sidebar match, so a row placed there moves into `#sidebar` when Torn hydrates it.

## Narrow screens

When Torn hides the sidebar (mobile, PDA), the row is not rendered. Each script then uses its own fallback:
ReviveRelay shows a floating pill, and Recruitment Agency uses its header status icon or its small edge tab.

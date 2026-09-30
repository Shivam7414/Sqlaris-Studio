---
name: build-ui
description: How to design and build UI in Sqlaris Studio so it looks like the rest of the app and not AI-generated, with text written in plain natural language. Use for any new screen, panel, dialog, menu, form, toast or empty state, any visual restyle, and any change to text people read on the page or in API error messages.
---

# Building UI in Sqlaris Studio

The goal: someone who uses this app every day cannot tell which parts are new. The page is
a dense, quiet tool for looking at data. It is not a landing page.

Also follow `.claude/rules/ui.md`. The wording guide with before/after examples is in
[copy.md](copy.md). Read it before writing any text.

## 1. Understand the job first

Before any markup, write down in two or three plain sentences:

- What the person is trying to get done, and where they are when they start.
- What they need to see to decide, and what they will click.
- What can go wrong (no rows, no permission, MySQL cannot do it, a slow query).

If you cannot say this, ask the user. Do not fill the gap with generic dashboard parts.

## 2. Find the nearest existing screen and copy its bones

`assets/app.js` has a pattern for nearly everything. Find the closest one and read it all
before writing:

| Need | Look at |
| --- | --- |
| A list of things with actions | `renderOverview`, `renderTableList` |
| A data table | `createGrid` (never build a second grid) |
| A form in a dialog | `nameForm`, `openModal`, the column form in the structure view |
| A dangerous action | `confirmByName` (type the name to confirm), `confirmBox({ danger: true })` |
| A question with one text answer | `askText` |
| A menu or a popover | `menuList`, `openMenuAt`, `openPopover` |
| A choice of 2 to 5 options | `segmented` |
| A number worth showing big | `stat`, `countUp` |
| Something loading | `skeleton` |
| Feedback after an action | `toast(message, kind, action)`, with an Undo action where it can be undone |
| Searchable select, date picker | `searchable`, `dateBox` |

Reuse the classes that screen uses (`btn`, `btn primary`, `muted`, `small`, `empty`, ...).
Search `assets/app.css` for a class before you make a new one.

## 3. Build it

- Elements come from `h()` and `put()`. Icons come from `icon(name)`, and a new icon is a
  24x24 stroke path added to `ICONS` in the same style as the others.
- Every colour, radius, shadow, font and duration is a token from `:root` in `app.css`.
  A new token gets a dark value, a light value (`:root[data-theme="light"]`) and the same
  light value in the `prefers-color-scheme` block.
- Put the one main action where the eye ends up, as `btn primary`. Everything else is a
  plain `btn` or goes in a menu. One primary per view.
- Every control works from the keyboard, has a `title`, and a shortcut if it is used
  often (add it to the shortcut list so `?` shows it and people can remap it).
- Data values show in `--mono`; NULL shows the way the grid shows it, not as an empty
  string.

## 4. Cover every state

A screen is not done until each of these has been seen, not imagined:

- Loading (skeleton), empty ("No rows match the search and filters."), one item, a lot of
  items (1000 rows, 200 tables), very long names, NULLs, and an error from the server.
- PostgreSQL and MySQL, where they differ.
- Dark and light theme, each page colour set that changes the look, a window about
  1000px wide, and reduced motion.

## 5. Check it looks like this app, not like a template

Go through this list honestly. If any answer is yes, change it.

- Could this screenshot come from a generic "admin dashboard" template?
- Is there a gradient, glow or blur that no other screen has?
- Is there an emoji, or an icon in front of every line, heading or button?
- Are there cards inside cards, or a shadow on every block?
- Is there a big heading or a subtitle that repeats what the page already says?
- Are there more than one primary button, or buttons labelled OK / Submit / Confirm?
- Does text say "Successfully", "Oops", "Please", "Are you sure", or end in "!"?
- Is anything centred that the rest of the app left-aligns?
- Did you add a colour, radius or font size that is not a token?

## 6. See it

Start the app (`php -S 127.0.0.1:8765 router.php`) and look at the change in a browser if
one is available (Claude in Chrome or the built-in browser). Check both themes. If you
cannot open a browser, say so in your report; do not claim the UI was checked.

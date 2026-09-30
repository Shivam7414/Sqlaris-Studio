---
paths:
  - "assets/**/*.js"
  - "assets/**/*.css"
  - "index.php"
---

# UI rules

These apply to every change under `assets/` and to `index.php`. For new screens, dialogs or
anything with layout decisions, also load the `build-ui` skill.

## Look

- Start from what exists. Find the closest screen that already does something similar
  (the overview, the data grid, the structure view, the health tab) and copy its markup and
  classes. A new view should be hard to tell apart from the old ones.
- Colours, radii, shadows, fonts and timings come from the tokens at the top of
  `assets/app.css`. Never write a raw hex, rgb or px radius in a component rule. If a token
  is missing, add it to `:root` and to the light theme block, both.
- Both themes, always. Anything added to the dark `:root` needs its light value in
  `:root[data-theme="light"]` and in the `prefers-color-scheme` block.
- Motion uses `--fast` / `--normal` / `--slow` and `--ease-out` / `--spring`, and stops
  under `prefers-reduced-motion`. Nothing moves just to look alive.
- Density: this is a tool for people who look at data all day. Tight rows, small type, real
  content. No hero sections, no big empty cards, no marketing layouts.

## Things that make it look AI-made. Do not do these.

- Purple-to-blue gradients, glowing borders, glassmorphism added for its own sake.
- An emoji or icon in front of every heading, list item or button.
- Every block in a card with a shadow; cards inside cards.
- Everything centred; three identical feature tiles in a row.
- Pill badges for values that are just text.
- Uniform big rounded corners on everything. Use the `--r-*` scale the way nearby code does.
- Placeholder copy: "Lorem ipsum", "Your data at a glance", "Welcome back!".

## Words

- Write what a helpful colleague would say, in plain sentences with a full stop.
  Sentence case everywhere: "Add a column", not "Add A Column".
- Say what happened and what to do next. Name the actual thing:
  "There is no table orders in this database." not "Invalid table."
- Buttons are verbs for the actual action: "Delete row", "Throw away", "Copy table".
  Not "OK", "Submit", "Yes", "Confirm" when a precise verb exists.
- Questions in confirms are the real question: "Delete this row?", "Throw away your
  changes?". Never "Are you sure?".
- No "Oops", "Whoops", "Something went wrong", "Successfully", "Please", "Error:",
  exclamation marks, or emoji. No "seamless", "effortless", "powerful", "unleash".
- Loading text is short and specific: "Counting...", "Connecting...". Keep the three
  dots the file already uses.
- Use the app's own words: database, table, row, column, SQL, sidebar. Not "entity",
  "record set", "resource", "item" when one of those is meant.

## Code

- Build elements with `h(tag, props, ...kids)` and `put(el, ...kids)`; text always goes
  in as text.
- Reuse `toast`, `confirmBox`, `confirmByName`, `openModal`, `askText`, `nameForm`,
  `menuList`, `openPopover`, `segmented`, `skeleton`, `stat`, `searchable`, `dateBox`.
- Every control is reachable by keyboard and has a `title` that says what it does. If it has
  a shortcut, use `withKey()` so the tooltip shows it.

# Words on the page

Everything a person reads is written like a helpful colleague talking: short, plain
sentences, full stops, no drama. This covers labels, buttons, tooltips, toasts, empty
states, confirms, placeholders, and the `DbvError` messages in PHP that the page shows.

## The voice, from the app itself

- "Copy did not work in this browser."
- "There is no table public.orders in this database."
- "This table has no primary key, or it is a view, so one row cannot be picked out. Use
  the SQL tab."
- "MySQL cannot empty the tables that point to this one in the same step. Empty those
  first."
- "Give the column a type, such as integer or varchar(100)."
- "No rows match the search and filters."
- "Its connection closes, and a transaction it has open is rolled back."
- "Throw away your changes?" with the button "Throw away".

The pattern for a problem: **what is true, why (if it is not obvious), what to do now.**

## Rules

1. Sentence case. "Add a column", "Hide audit columns". Only names are capitalised.
2. A full stop ends every sentence in toasts, errors, dialogs and empty states. Labels,
   buttons, menu items and titles have none.
3. Buttons say the action: "Delete row", "Copy table", "Run", "Throw away". Never OK /
   Yes / Submit / Confirm when a verb exists. Cancel stays Cancel.
4. A confirm asks the real question with the object in it: "Delete 3 rows?",
   "Drop the table orders?". The body says the consequence, not "This cannot be undone"
   boilerplate unless that is the one thing they need to know.
5. Name the actual thing. Use the table, column or database name. Use the app's nouns:
   database, table, view, row, column, key, SQL, sidebar.
6. Say what happened, not how the code felt: "Row deleted.", "Download started.",
   "Nothing has changed."
7. Numbers get their noun and the right plural: "1 row", "3 rows". Use `n === 1 ? ... : ...`
   like the existing code.
8. Loading text is one or two words with three dots: "Counting...", "Connecting...".
9. Tooltips say what the control does, as a phrase: "Download every row that matches",
   "Reload counts and rows". Add the shortcut with `withKey()`.
10. When the database gives its own message, pass it on (`DbvDriver::message`). Do not wrap
    it in "Error: ...".

## Before and after

| Instead of | Write |
| --- | --- |
| Oops! Something went wrong. | Could not reach the pgsql server. Is it running? |
| Are you sure you want to delete? | Delete this row? |
| Successfully deleted the row! | Row deleted. |
| Invalid input | Use only letters, digits and underscores, up to 63 characters. |
| Error: Table not found | There is no table orders in this database. |
| Please enter a value | Write a query first. |
| No data available | This database has no tables. |
| Your data, supercharged | (nothing; cut it) |
| Click here to learn more | Open the row |
| Loading, please wait... | Counting... |
| Submit | Save column |
| Warning! This action is irreversible! | The table and its rows are gone for good. |

## Read it out loud

Before finishing, read each new string out loud. If a person at the next desk would not say
it that way, rewrite it. If it would be fine with half the words, cut half.

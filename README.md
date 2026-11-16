# NyayaTrack GUI – MC212 Lab 11

A web front end for the NyayaTrack court-case database (MC212 DBMS, Group 6), built on the final V5 schema.

- **Backend:** Node.js + Express REST API using `pg` with `$1, $2 …` placeholders
- **Frontend:** plain HTML/JavaScript pages with dropdown filters and dark mode
- **Access control:** you sign in as a user account; every request runs under that account's database role
  (`nyaya_clerk`, `nyaya_judge`, …) with `nyaya.personid` set, so row-level security and the audit trail apply

**Lab 11 submission (sections A–D with screenshots): [Lab11_Submission](Lab11_Submission/README.md)**

## Features

- **Cases**: file a new case (always starts as Filed), including an appeal of a decided case in a higher court or a case heard with a lead case; list with filters and sort; edit within the allowed status moves (CNR, which must be unique, registration date, stage, priority, disposal type, return reason, lead case). Delete is refused by the database (append-only records).
- **Case file**: parties (new persons go through the duplicate-person check), fee payments, hearings, orders recorded by the judge at a held hearing (one Final order per case, related orders of the same case), adjournments, documents with "Issue summons / notice" through `fn_issue_process_document`, judge assignment and history. A Final order lets the registry dispose of the case by Judgment, Mediation, Lok Adalat or Withdrawal.
- **Dashboard**: total, pending and heard-this-month cases; pending cases by type in three age bands; cases by status.
- **Search**: by CNR, party, advocate, filing dates or old register reference through `fn_search_cases`.
- **Case details**: header, linked cases in both directions (appeal of / appealed in, lead case / heard with this one), parties with advocates, judge assignment history, hearings, orders with the order they follow, adjournments with a warning when one party asked more than twice.
- **Cause list**: any court and date, urgent and liberty matters first, with a Reschedule button for your own court.
- **Reschedule**: moves a listed hearing with `sp_reschedule_hearing`, refuses double-bookings, and lists everyone to notify from `v_notification_queue`.
- **Transfer**: hands a case to another judge with `sp_transfer_case` and a handover note, then shows the assignment history (Court Admin).
- **Audit trail**: every change to a case from `v_case_timeline`, newest first, as "field: old → new" with who made it.
- **Litigant view**: what a party sees in the portal, run as `nyaya_litigant` so the database limits it to their own cases.
- **Advocate view**: an advocate's multi-case dashboard (`v_advocate_my_cases`), run as `nyaya_advocate` so the database limits it to the cases they appear in.
- **Reports** and **Notifications**: pendency drill-down, disposal types, repeated adjournment grounds, and the notification feed.

## Run it

```bash
npm install
cp .env.example .env    # then fill in your database name and password
npm start               # open http://localhost:3000
```

The database must be built with the V5 SQL files (`01_create_tables.sql` → `02_rules.sql` → `03_populate.sql`).

## What each role sees

| Role | Screens |
|---|---|
| Registry Clerk | Cases (file, register, edit), case file (parties, fee, hearings, documents, summons, adjournment requests), cause list, search, reports, notification feed |
| Court Admin | Same as the clerk, plus judge transfer / roster change with handover note |
| Judge | Cases of own court, priority and stage, hearing outcomes, orders with conditions, adjournment decisions, cause list, search, reports |
| Advocate | Dashboard of own cases across courts, coming hearings, documents |
| Litigant | Own case status in plain language, hearings, orders, documents |
| System Admin | User accounts and the technical audit summary (no case data) |

## Files

| File | Purpose |
|---|---|
| `db.js` | Creates the `pg` connection pool from `.env` and exports it |
| `test-connection.js` | Prints `SELECT version()` to prove the connection works |
| `inspect-schema.js` | Lists tables and `court_case` columns from `information_schema` |
| `server.js` | Case CRUD routes: `POST/GET /api/cases`, `PUT/DELETE /api/cases/:id` |
| `lib/session.js` | Signs in the account and runs each request under its database role |
| `lib/validate.js`, `lib/errors.js` | Input checks and readable database error messages |
| `routes/casefile.js` | Parties, payments, hearings, orders, adjournments, documents, assignment, transfer, history |
| `routes/registry.js` | Cause list, multi-criteria search, pendency reports, notification feed |
| `routes/portals.js` | Litigant and advocate portals, account administration |
| `public/` | The web pages (`index.html`, `css/`, `js/`) |

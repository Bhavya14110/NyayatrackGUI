# NyayaTrack GUI – MC212 Lab 11

A web front end for the NyayaTrack court-case database (MC212 DBMS, Group 6), built on the final V5 schema.

- **Backend:** Node.js + Express REST API using `pg` with `$1, $2 …` placeholders
- **Frontend:** plain HTML/JavaScript pages with dropdown filters and dark mode
- **Access control:** you sign in as a user account; every request runs under that account's database role
  (`nyaya_clerk`, `nyaya_judge`, …) with `nyaya.personid` set, so row-level security and the audit trail apply

**Lab 11 submission (sections A–D with screenshots): [Lab11_Submission](Lab11_Submission/README.md)**

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

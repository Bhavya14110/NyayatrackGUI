# NyayaTrack GUI – MC212 Lab 11

A web front end for the NyayaTrack court-case database (MC212 DBMS, Group 6). It does full CRUD on the `COURT_CASE` table:

- **Backend:** Node.js + Express REST API using `pg` with `$1, $2 …` placeholders
- **Frontend:** a plain HTML/JavaScript page with dropdown filters and dark mode

**Lab 11 submission (sections A–D with screenshots): [Lab11_Submission](Lab11_Submission/README.md)**

## Run it

```bash
npm install
cp .env.example .env    # then fill in your database name and password
npm start               # open http://localhost:3000
```

| File | Purpose |
|---|---|
| `db.js` | Creates the `pg` connection pool from `.env` and exports it |
| `test-connection.js` | Prints `SELECT version()` to prove the connection works |
| `inspect-schema.js` | Lists tables and `court_case` columns from `information_schema` |
| `server.js` | Express routes: `POST/GET /api/cases`, `PUT/DELETE /api/cases/:id` |
| `public/index.html` | Add / edit form, filters, cases table with Edit and Delete |

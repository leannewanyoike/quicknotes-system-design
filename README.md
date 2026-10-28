# QuickNotes System Design

QuickNotes is a note-taking app that is moving from a browser-only app to an online service for 1 million users. This repository has two halves:

1. **An API client** (`index.html`, `api.js`, `style.css`) that proves the front end can talk to a REST API. It loads, creates and deletes notes using the [JSONPlaceholder](https://jsonplaceholder.typicode.com/) practice API, with loading, success, error and empty states, input validation and disabled buttons during requests.
2. **Design documents** for the backend team: the REST API, the database model and the architecture needed to serve 1 million users.

## How to run the API client

No build step or installation is needed.

1. Clone the repository:
   ```bash
   git clone https://github.com/leannewanyoike/quicknotes-system-design.git
   cd quicknotes-system-design
   ```
2. Open `index.html` in a web browser (double-click it), **or** serve the folder locally, which behaves more like a real website:
   ```bash
   python3 -m http.server 8000
   ```
   Then visit <http://localhost:8000>. The VS Code "Live Server" extension also works.
3. You need an internet connection, because the page calls `https://jsonplaceholder.typicode.com/posts`.

### What you can do

| Action | Request | What you see |
|---|---|---|
| Click **Load notes** | `GET /posts?_limit=10` | "Loading notes..." while waiting, then 10 notes and "Loaded 10 notes from the server." |
| Fill in the form and click **Create note** | `POST /posts` with `{ title, body, userId: 1 }` | The new note at the top of the list and, for example, "Note created (status 201, id 101)." |
| Click **Delete** on a note | `DELETE /posts/{id}` | The note disappears and the status shows "Note deleted (status 200)." |

**Validation:** the title is required and can be at most 100 characters; a counter under the field shows the length. The body is optional.

**Testing the error state:** turn off your internet connection (or use the browser DevTools → Network → Offline) and click **Load notes**. A friendly error message appears.

**Note about JSONPlaceholder:** it answers like a real API but does not store changes. Every created note gets id 101, and deleted notes come back after reloading. Notes created in this session are therefore removed from the page without a DELETE request; the reasoning is explained in a comment in `api.js`.

## Design documents

- [API design](docs/api-design.md): REST endpoints, request and response examples, and error codes for the real QuickNotes API.
- [Data model](docs/data-model.md): the users, notes, tags and note_tags tables, relationships, SQL, indexes and the SQL vs NoSQL decision.
- [Architecture](docs/architecture.md): requirements, the load estimate for 1 million users, the architecture diagram, request flows, trade-offs and how single points of failure are avoided.

## Project structure

```text
quicknotes-system-design/
├── index.html          page structure: form, status line, notes list
├── api.js              API client: request(), GET, POST, DELETE
├── style.css           layout, note cards and status styles
├── README.md
└── docs/
    ├── api-design.md
    ├── data-model.md
    └── architecture.md
```

## What I learned

- **`fetch` does not fail on HTTP errors.** A 404 or 500 still resolves successfully, so a reusable `request()` function must check `response.ok` and throw. Putting this in one place means every GET, POST and DELETE handles errors the same way.
- **A good interface shows every state, not just success.** Loading, success, error and empty states, plus disabling buttons during a request, stop users from clicking twice and tell them what is happening. Inserting user text with `textContent` instead of `innerHTML` prevents cross-site scripting.
- **Estimate before designing.** Simple maths (1 day ≈ 100,000 seconds) showed that 1 million users means only about 200 requests per second at peak and 180 GB per year. QuickNotes needs a cache, replicas and a few servers, not sharding or microservices.
- **Every component solves a specific problem and has a cost.** A cache makes reads fast but can serve stale data; replicas add read capacity but lag slightly; a queue keeps responses fast but delays the work. Naming the trade-off out loud is part of good design.
- **Design the data before the code.** A many-to-many relationship such as notes and tags needs a join table, and the most frequent query decides which index to create.

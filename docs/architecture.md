# QuickNotes Architecture for 1 Million Users

This document describes how QuickNotes moves from a browser-only app to an online service used by 1 million people. It builds on the [API design](api-design.md) and the [data model](data-model.md).

## 1. Requirements

### Functional requirements (what the system does)

- Users can register, log in and log out.
- Users can create a note with a title (required, up to 100 characters) and an optional body.
- Users can see a list of their own notes, newest first, page by page.
- Users can open, edit and delete their own notes.
- Users can add tags to notes and filter their notes by tag.
- Users can never see or change another user's notes.
- Users receive a welcome email after registering and can request an export of all their notes (both done in the background).

### Non-functional requirements (how well it does it)

- **Scale:** 1,000,000 registered users and 200,000 daily active users.
- **Latency:** `GET /notes` responds in under 200 ms for 95% of requests (p95), so the app feels instant.
- **Availability:** 99.9% ("three nines"), which allows about 8.8 hours of downtime per year. No single machine failure should take the service down.
- **Durability:** a saved note is never lost; the database is replicated and backed up daily.
- **Consistency:** a note list that is a second or two out of date is acceptable, but a user must never see another user's notes.
- **Security:** HTTPS everywhere, hashed passwords, token-based authentication and rate limiting (100 requests per minute per user).
- **Maintainability:** start as one well-organised monolith that a small team can build, test and deploy.

## 2. Load estimate

### Assumptions

| Assumption | Value |
|---|---|
| Registered users | 1,000,000 |
| Active on a given day | 20%, so 200,000 daily active users (DAU) |
| Notes created per active user per day | 5 |
| Note list loads per active user per day | 20 |
| Average note size including extra fields | 500 bytes |
| Peak traffic | 5× the average |

### Calculation

```text
Seconds in a day ≈ 86,400  (round to 100,000 for easy maths)

Writes (new notes):  200,000 users × 5 notes   = 1,000,000 per day
                     1,000,000 ÷ 100,000       ≈ 10 writes per second
                     Peak (5×)                 ≈ 50 writes per second

Reads (load notes):  200,000 users × 20 loads  = 4,000,000 per day
                     4,000,000 ÷ 100,000       ≈ 40 reads per second
                     Peak (5×)                 ≈ 200 reads per second

Storage per year:    1,000,000 notes/day × 500 bytes = 500 MB per day
                     500 MB × 365                    ≈ 180 GB per year
```

### What the numbers tell us

- **The system is read-heavy** (4× more reads than writes), so a cache and read replicas give the biggest benefit.
- **200 requests per second at peak** is manageable for a few ordinary app servers. We use three so that one can fail without problems.
- **180 GB per year** fits comfortably in one PostgreSQL primary, so sharding is not needed yet. Over-engineering is also a mistake.

## 3. Architecture diagram

```text
                          ┌─────────┐
           ┌─────────────>│   DNS   │  quicknotes.com → IP addresses
           │              └─────────┘
  ┌────────┴──────┐  index.html, style.css, api.js  ┌──────────────────┐
  │ Browser /     │ ──────────────────────────────> │ CDN edge servers │
  │ mobile client │                                 └──────────────────┘
  └────────┬──────┘
           │ API calls: HTTPS + JSON
           v
   ┌───────────────┐
   │ Load balancer │  health checks every few seconds
   └───────┬───────┘
      ┌────┴─────┬──────────┐
      v          v          v
  ┌───────┐  ┌───────┐  ┌───────┐      ┌───────────────┐
  │ App 1 │  │ App 2 │  │ App 3 │ ───> │ Cache (Redis) │
  └───┬───┘  └───┬───┘  └───┬───┘      └───────────────┘
      │ writes   │ reads    │ jobs
      v          v          v
  ┌─────────┐ ┌──────────┐ ┌───────┐   ┌────────┐
  │ Primary │>│ Read     │ │ Queue │──>│ Worker │  welcome emails, exports
  │   DB    │ │ replicas │ └───────┘   └────────┘
  └─────────┘ └──────────┘

  ">" between Primary DB and Read replicas = every change is copied to the replicas.
  All three app servers use the same cache, databases and queue; each arrow is drawn once.
```

**How to read it:** the browser uses DNS once, then downloads the front end from the CDN. Every API call goes to the load balancer, which spreads it over three identical, stateless app servers. At the bottom, each type of work goes to the component built for it: writes go to the primary database, reads go to the cache first and then the replicas, and slow jobs go to the queue for the worker.

## 4. Components and the problem each one solves

| Component | Problem it solves |
|---|---|
| **Client (browser / mobile app)** | Gives users an interface to write and read notes, and talks to the server only through the documented REST API. |
| **DNS** | Users remember `quicknotes.com`, not IP addresses, so DNS translates the name into the addresses of the CDN and load balancer. |
| **CDN** | Static files from a distant server are slow (200 ms or more), so edge servers near the user deliver them in about 20–40 ms and take that traffic off our own servers. |
| **Load balancer** | One server is a single point of failure with limited capacity, so the load balancer spreads requests across several servers and skips any server that fails its health check. |
| **App servers (3, stateless)** | Run the API code (authentication, validation, business rules); because they keep no user data in memory, any server can handle any request and servers can be added or removed freely. |
| **Cache (Redis)** | Most requests are reads of the same note lists, so keeping them in memory answers 80–90% of reads in about 1 ms and protects the database from that load. |
| **Primary database (PostgreSQL)** | Notes must be stored safely and consistently, so the primary is the single source of truth and the only database that accepts writes. |
| **Read replica(s)** | Reads outnumber writes 4 to 1, so replicas answer read queries that miss the cache and can be promoted to primary if the primary fails. |
| **Message queue** | Sending emails or building exports is slow, so the app adds a job to the queue and replies to the user immediately; spikes of jobs simply wait instead of overloading the system. |
| **Worker** | Someone has to do the slow jobs, so separate worker servers take jobs from the queue and process them in the background, retrying failures. |

Monitoring supports all of them: **logs** record events and errors, **metrics** track requests per second, error rate, p95 latency and cache hit rate, and **alerts** notify an engineer when, for example, more than 1% of requests fail.

## 5. Request flows

### GET /notes (load the note list)

1. **Load the app.** The browser looks up `quicknotes.com` in DNS (usually cached: 0–20 ms) and downloads `index.html`, `style.css` and `api.js` from a nearby CDN edge server (20–40 ms). On the next visit the browser cache may serve them with no download at all.
2. **Send the request.** The client sends `GET /v1/notes?page=1&limit=20` with the header `Authorization: Bearer <token>`.
3. **Load balancer.** It forwards the request to the least busy healthy app server (about 1 ms).
4. **Check the token.** The app server verifies the token and finds the user, for example user 1 (1–2 ms). An invalid token returns `401`.
5. **Check the cache.** The app server asks Redis for the key `notes:user:1:page:1`.
   - **Cache hit:** the notes come back in about 1 ms. Go to step 7.
   - **Cache miss:** go to step 6.
6. **Query a read replica.** The app server runs the "newest notes" query from the data model, which uses the index `idx_notes_user_created` (5–20 ms). It stores the result in Redis with a TTL of 5 minutes, so the next request is a hit.
7. **Respond.** The app server returns `200 OK` with the notes and pagination as JSON. Total time at the server is under 10 ms on a hit and about 25 ms on a miss.
8. **Show the notes.** The client builds the list with `textContent`, shows "Loaded 20 notes", or shows the empty-state message if `data` is empty.

### POST /notes (create a note)

1. **Submit the form.** The client checks that the title is present and at most 100 characters, disables the submit button, and sends `POST /v1/notes` with `{ "title", "body", "tags" }`.
2. **Load balancer.** It forwards the request to any healthy app server.
3. **Check token and rate limit.** The app server identifies the user and checks the limit of 100 requests per minute (`401` or `429` if it fails).
4. **Validate again on the server.** The server never trusts the client: an empty or too-long title returns `400` with the standard error body.
5. **Write to the primary database.** In one transaction, the server inserts the note and its `note_tags` rows into the **primary** database, because only the primary accepts writes (5–10 ms).
6. **Invalidate the cache.** It deletes the user's cached note lists from Redis (`notes:user:1:*`), so stale lists are never served. The next GET will be a cache miss and fetch fresh data.
7. **Respond.** It returns `201 Created` with the new note (including its id) and a `Location` header.
8. **Replicate.** Within a few milliseconds, the primary copies the new rows to the read replicas.
9. **Update the page.** The client adds the note to the top of the list, shows "Note created", clears the form and re-enables the button.

If the note needed slow extra work (for example, the user's first note triggers a "getting started" email), step 7 would also add a job to the queue, and a worker would handle it after the response has been sent.

## 6. Trade-offs

**Speed versus freshness (cache and read replicas).** Redis and the replicas make reads fast and protect the primary, but they can return slightly old data: a cached list may be stale until it is invalidated or expires, and a replica can lag a few milliseconds behind the primary. For a personal notes app, a list that is a second out of date is acceptable, which is why we chose this design. To avoid confusing users, we delete their cache entries on every write, so the user who just saved a note sees it on the next load. A banking app would make the opposite choice and favour consistency.

**Simplicity versus scalability (monolith instead of microservices).** One application deployed on three identical servers is easy to build, test, debug and deploy for a small team, and the load estimate shows we do not need more. Microservices would let separate teams scale and deploy the notes, accounts and search parts independently, but they would add network failures between services and much more infrastructure. We will split a part out only if there is a clear reason, for example if search needs very different hardware.

**Cost versus reliability (extra servers).** Three app servers, a replica and a second cache node cost more than one powerful machine. We accept that cost because the requirement is 99.9% availability, and one machine can never reach that on its own.

**Sync versus async (queue and worker).** Background jobs keep responses fast and absorb spikes, but the user does not get the welcome email or export instantly, and a failed job must be retried and monitored. That delay is fine for emails and exports.

## 7. Avoiding single points of failure

A single point of failure (SPOF) is a part that takes the whole system down if it breaks. Every component in the design has a backup:

| Component | How the single point of failure is removed |
|---|---|
| App servers | Three identical, stateless servers. If one crashes, the load balancer's health check notices within seconds and stops sending traffic to it; clients retry failed requests with back-off and land on a healthy server. No data is lost because nothing is stored on the app servers. |
| Load balancer | Run as a managed cloud load balancer (or two load balancers in active–passive mode), which is itself spread across several machines and zones. |
| Primary database | Replicated to at least one read replica. If the primary fails, a replica is promoted to primary (failover). Daily backups protect against mistakes such as accidental deletion. |
| Cache | A Redis primary with a replica. If the cache is completely lost, the system is slower but still correct, because every read can fall back to the database. |
| Queue and workers | A managed queue (such as Amazon SQS) keeps jobs on several machines; at least two workers run, and a job that fails is returned to the queue and retried. |
| CDN and DNS | Provided by global services with many servers; if the CDN fails, files can be served from the origin server. |
| Whole data centre | Servers are spread across at least two availability zones, so a power or network failure in one building does not stop the service. |

**Graceful degradation:** if a non-essential part fails, the core features keep working. If the email worker is down, users can still read and write notes, and emails are sent when the worker returns. Timeouts make sure a slow database or cache causes a quick error instead of requests waiting forever.

**Worked failure example:** App Server 2 crashes at 10:00. The load balancer's health check gets no reply, so within seconds all traffic goes to App 1 and App 3. Requests that were running on App 2 fail and the client retries them. An alert notifies the on-call engineer and an automatic system starts a replacement server. Most users notice nothing.

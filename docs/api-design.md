# QuickNotes API Design

This document describes the real QuickNotes REST API for the backend team to build. It is separate from the JSONPlaceholder practice API used by the front-end prototype.

## Conventions

- **Base URL:** `https://api.quicknotes.com/v1`. The version is in the path so a future `/v2` can be introduced without breaking existing clients.
- **Format:** Requests and responses use JSON. Send `Content-Type: application/json` with requests that have a JSON body.
- **Authentication:** Register and login are public. All other endpoints require `Authorization: Bearer <access_token>`, returned by `POST /auth/login`.
- **Ownership:** Users can only view and change their own notes and tags.
- **Resources:** Paths use nouns and HTTP methods express actions (for example, `DELETE /notes/{id}`).
- **IDs:** Positive integers. **Timestamps:** ISO 8601 in UTC, for example `2026-10-27T09:15:00Z`.
- **Validation:** A note title is required and at most 100 characters; a body is optional and at most 10,000 characters; a tag name is 1–50 characters.

## Endpoints

| Method | Path | Description | Success status |
|---|---|---|---|
| POST | `/auth/register` | Create an account with an email, password and display name | 201 Created |
| POST | `/auth/login` | Authenticate with an email and password and receive an access token | 200 OK |
| GET | `/notes` | List the current user's notes, newest first; supports pagination (`?page=1&limit=20`) and an optional tag filter (`?tag=work`) | 200 OK |
| POST | `/notes` | Create a note, optionally with tags | 201 Created |
| GET | `/notes/{id}` | Get one note with its tags | 200 OK |
| PATCH | `/notes/{id}` | Update one or more note fields (title, body or tags) | 200 OK |
| DELETE | `/notes/{id}` | Permanently delete a note | 204 No Content |
| GET | `/tags` | List the current user's tags and how many notes use each | 200 OK |
| POST | `/tags` | Create a tag | 201 Created |
| DELETE | `/tags/{id}` | Delete a tag and remove it from its notes; keep the notes | 204 No Content |

`PATCH` lets clients update only the fields that changed, without sending the entire note as `PUT` would require.

## Example: create a note

**Request**

```http
POST /v1/notes HTTP/1.1
Host: api.quicknotes.com
Authorization: Bearer <access_token>
Content-Type: application/json
```

```json
{
  "title": "Shopping list",
  "body": "Milk, eggs, bread",
  "tags": ["home", "errands"]
}
```

**Response: 201 Created**

```http
HTTP/1.1 201 Created
Location: /v1/notes/42
Content-Type: application/json
```

```json
{
  "id": 42,
  "title": "Shopping list",
  "body": "Milk, eggs, bread",
  "tags": ["home", "errands"],
  "createdAt": "2026-10-27T09:15:00Z",
  "updatedAt": "2026-10-27T09:15:00Z"
}
```

The server creates any tags the user does not already have. The `Location` header identifies the new note.

## Example: list notes

**Request**

```http
GET /v1/notes?page=1&limit=2 HTTP/1.1
Host: api.quicknotes.com
Authorization: Bearer <access_token>
```

**Response: 200 OK**

```json
{
  "data": [
    {
      "id": 42,
      "title": "Shopping list",
      "body": "Milk, eggs, bread",
      "tags": ["home", "errands"],
      "createdAt": "2026-10-27T09:15:00Z",
      "updatedAt": "2026-10-27T09:15:00Z"
    },
    {
      "id": 41,
      "title": "Day 8 presentation",
      "body": "Practise the 3-minute walkthrough of the architecture diagram.",
      "tags": ["school"],
      "createdAt": "2026-10-26T18:02:11Z",
      "updatedAt": "2026-10-26T18:40:05Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 2,
    "total": 57,
    "totalPages": 29
  }
}
```

If the user has no notes, return `200 OK` with `"data": []`. An empty list is a valid result, not an error.

## Example: update a note

**Request**

```http
PATCH /v1/notes/42 HTTP/1.1
Host: api.quicknotes.com
Authorization: Bearer <access_token>
Content-Type: application/json
```

```json
{
  "title": "Groceries",
  "tags": ["home"]
}
```

**Response: 200 OK**

```json
{
  "id": 42,
  "title": "Groceries",
  "body": "Milk, eggs, bread",
  "tags": ["home"],
  "createdAt": "2026-10-27T09:15:00Z",
  "updatedAt": "2026-10-27T10:00:00Z"
}
```

Fields omitted from the patch remain unchanged.

## Example: delete a note

```http
DELETE /v1/notes/42 HTTP/1.1
Host: api.quicknotes.com
Authorization: Bearer <access_token>
```

Response: `204 No Content` with an empty body.

## Error status codes

| Status | Meaning | When QuickNotes returns it |
|---|---|---|
| 400 Bad Request | The request is invalid | The JSON cannot be parsed, a title is missing or longer than 100 characters, or `limit` is not a number |
| 401 Unauthorized | Authentication is missing or invalid | The `Authorization` header is missing, or the token is invalid or expired |
| 403 Forbidden | The user is not allowed to access the resource | The note or tag belongs to another user |
| 404 Not Found | The resource does not exist | No note or tag has that id, or the path is wrong |
| 409 Conflict | The request conflicts with existing data | Registering an email that is already used, or creating a tag name the user already has |
| 429 Too Many Requests | The rate limit was reached | The user sent more than 100 requests in one minute; `Retry-After` says how many seconds to wait |
| 500 Internal Server Error | An unexpected server failure occurred | An unexpected bug or database failure; details are logged and not exposed to the user |

**403 or 404?** Returning 403 reveals that another user's resource exists. Many APIs return 404 instead to keep other users' notes invisible. This design lists 403 for clarity; the team should choose and apply one policy consistently before implementation.

### Error response body

All errors use a consistent shape so clients can handle them uniformly:

```json
{
  "error": {
    "status": 400,
    "code": "VALIDATION_ERROR",
    "message": "The note could not be saved because some fields are invalid.",
    "details": [
      { "field": "title", "message": "Title is required." }
    ]
  }
}
```

- `status` repeats the HTTP status code.
- `code` is a stable programmatic value: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED` or `INTERNAL_ERROR`.
- `message` is a friendly sentence suitable for display to the user.
- `details` is included for validation errors and lists the invalid fields.

A 500 response never includes stack traces or SQL:

```json
{
  "error": {
    "status": 500,
    "code": "INTERNAL_ERROR",
    "message": "Something went wrong on our side. Please try again in a moment."
  }
}
```

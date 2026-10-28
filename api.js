/*
 * QuickNotes API client
 *
 * Proves that the QuickNotes front end can talk to a REST API.
 * It uses the JSONPlaceholder practice API, which accepts real HTTP
 * requests but does not really save any changes.
 *
 * Security rule for this file: user text is only ever inserted into the
 * page with textContent, never parsed as HTML, so typed HTML is shown as
 * plain text instead of being run by the browser.
 */

const API_URL = "https://jsonplaceholder.typicode.com/posts";
const NOTES_LIMIT = 10;
const TITLE_MAX_LENGTH = 100;

// Page elements
const loadBtn = document.getElementById("load-btn");
const statusEl = document.getElementById("status");
const notesList = document.getElementById("notes-list");
const noteForm = document.getElementById("note-form");
const titleInput = document.getElementById("title-input");
const bodyInput = document.getElementById("body-input");
const submitBtn = document.getElementById("submit-btn");
const titleCount = document.getElementById("title-count");

/* ------------------------------------------------------------------ */
/* Reusable request helper                                             */
/* ------------------------------------------------------------------ */

/**
 * Sends one HTTP request and returns { status, data }.
 * Throws an Error with a friendly message if the network fails or the
 * server answers with a status outside 200–299.
 */
async function request(url, options = {}) {
  // Only requests that send a body need the JSON content-type header.
  const headers = options.body
    ? { "Content-Type": "application/json; charset=UTF-8" }
    : {};

  let response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (networkError) {
    // fetch only rejects when the request could not be sent at all
    // (no internet, DNS failure, blocked by the browser).
    throw new Error(
      "Could not reach the server. Check your internet connection and try again."
    );
  }

  // fetch does NOT reject on 404 or 500, so we must check response.ok ourselves.
  if (!response.ok) {
    const error = new Error(
      `The server returned an error (status ${response.status}). Please try again.`
    );
    error.status = response.status;
    throw error;
  }

  // Some responses (for example to DELETE) may have an empty body,
  // so only parse JSON when there is something to parse.
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { status: response.status, data };
}

/* ------------------------------------------------------------------ */
/* Page helpers                                                        */
/* ------------------------------------------------------------------ */

/** Shows a message in the status line. type: loading | success | error | info */
function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status status--${type}`;
}

/** Replaces the list with a single empty-state message. */
function showEmptyState() {
  const item = document.createElement("li");
  item.id = "empty-state";
  item.className = "empty-state";
  item.textContent = "No notes to show yet. Load notes from the server or create your first note.";
  notesList.replaceChildren(item);
}

function removeEmptyState() {
  const emptyState = document.getElementById("empty-state");
  if (emptyState) emptyState.remove();
}

/** Builds the <li> for one note. isLocal marks notes created in this session. */
function createNoteElement(note, isLocal = false) {
  const item = document.createElement("li");
  item.className = "note";

  const title = document.createElement("h3");
  title.className = "note__title";
  title.textContent = note.title;

  const body = document.createElement("p");
  body.className = "note__body";
  if (note.body) {
    body.textContent = note.body;
  } else {
    body.textContent = "No details";
    body.classList.add("note__body--empty");
  }

  item.append(title, body);
  item.dataset.id = note.id;
  if (isLocal) item.dataset.local = "true";

  return item;
}

/* ------------------------------------------------------------------ */
/* GET: load 10 notes                                                  */
/* ------------------------------------------------------------------ */

async function loadNotes() {
  loadBtn.disabled = true;
  notesList.setAttribute("aria-busy", "true");
  showStatus("Loading notes...", "loading");

  try {
    const { data } = await request(`${API_URL}?_limit=${NOTES_LIMIT}`);

    if (!Array.isArray(data) || data.length === 0) {
      showEmptyState();
      showStatus("The server has no notes yet.", "info");
      return;
    }

    // Loading replaces whatever was on the page with the server's notes.
    notesList.replaceChildren(...data.map((note) => createNoteElement(note)));
    showStatus(`Loaded ${data.length} notes from the server.`, "success");
  } catch (error) {
    showStatus(`Could not load notes. ${error.message}`, "error");
  } finally {
    loadBtn.disabled = false;
    notesList.removeAttribute("aria-busy");
  }
}

/* ------------------------------------------------------------------ */
/* POST: create a note                                                 */
/* ------------------------------------------------------------------ */

/** Returns an error message, or an empty string if the title is valid. */
function validateTitle(title) {
  if (title === "") {
    return "Please enter a title for your note.";
  }
  if (title.length > TITLE_MAX_LENGTH) {
    return `The title is ${title.length} characters long. Please shorten it to ${TITLE_MAX_LENGTH} characters or fewer.`;
  }
  return "";
}

/** Keeps the "0 / 100" counter under the title field up to date. */
function updateTitleCount() {
  const length = titleInput.value.trim().length;
  titleCount.textContent = `${length} / ${TITLE_MAX_LENGTH}`;
  titleCount.classList.toggle("field__count--over", length > TITLE_MAX_LENGTH);
}

async function createNote(event) {
  event.preventDefault();

  const title = titleInput.value.trim();
  const body = bodyInput.value.trim(); // the body is optional

  const validationError = validateTitle(title);
  if (validationError) {
    showStatus(validationError, "error");
    titleInput.setAttribute("aria-invalid", "true");
    titleInput.focus();
    return;
  }
  titleInput.removeAttribute("aria-invalid");

  submitBtn.disabled = true;
  showStatus("Creating note...", "loading");

  try {
    const { status, data } = await request(API_URL, {
      method: "POST",
      body: JSON.stringify({ title, body, userId: 1 }),
    });

    removeEmptyState();
    notesList.prepend(createNoteElement(data, true));
    showStatus(`Note created (status ${status}, id ${data.id}).`, "success");

    noteForm.reset();
    updateTitleCount();
  } catch (error) {
    // Keep what the user typed so they can try again.
    showStatus(`Could not create the note. ${error.message}`, "error");
  } finally {
    submitBtn.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Start-up                                                            */
/* ------------------------------------------------------------------ */

loadBtn.addEventListener("click", loadNotes);
noteForm.addEventListener("submit", createNote);
titleInput.addEventListener("input", updateTitleCount);

showEmptyState();

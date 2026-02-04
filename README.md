# Textbook Margin Enhancer (100% Vibe-coded)

A client-side web application that processes PDF textbooks to add wide margins for note-taking. It utilizes PDFium via WebAssembly (WASM) to modify PDF structures directly in the browser, ensuring user privacy by keeping all data local.

## Features

* **Client-Side Processing:** No server uploads required; all processing happens in the browser.

* **Configurable Margins:**

  * Adjust margin size (1" to 5").

  * Select margin position: Right, Left, or Alternating (Outer margins for double-sided printing).

* **Drag-and-Drop Interface:** Simple UI for loading and processing files.

## Prerequisites

To run this application locally, you need the following files in the same directory:

1. `index.html` (The application interface)

2. `worker.js` (The background processing script)

3. `pdfium.js` (Emscripten glue code for PDFium)

4. `pdfium.wasm` (Compiled WebAssembly module)

**Note:** You must obtain a compatible build of `pdfium.js` and

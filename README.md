# Math PDF Enhancer for Tablets (100% Vibe-coded by Gemini 3 Pro)

A client-side web application that processes PDFs to add wide margins for note-taking. It utilizes PDFium via WebAssembly (WASM) to modify PDF structures directly in the browser, ensuring user privacy by keeping all data local. Can be especially useful for annotating PDFs on an e-ink device that doesn't support two documents side-by-side (e.g. Kindle Scribe, reMarkable 2). 

## Features

* **Client-Side Processing:** No server uploads required; all processing happens in the browser.
* **Batch Processing:**
  * Process multiple PDFs simultaneously using multi-threaded Web Workers.
  * Automatically bundles multiple outputs into a single ZIP file.
* **Smart Layouts:**
  * **Tablet Match:** Optimizes margins for specific devices (Kindle Scribe, reMarkable 2, iPad Pro, Boox, Supernote, Samsung Galaxy Tab).
  * **Fixed Margins:** Manually adjust margin size (1" to 5").
  * **Justification:** Right, Left, or Alternating (Outer margins for double-sided printing).
  * **Robust Content Detection:** Accurately identifies bounding boxes for text, images, and vector graphics, even within nested structures (XObjects/Forms).
* **Modern UI:**
  * Drag-and-drop interface.
  * Dark mode support (respects system preference).
  * Settings are automatically saved to your browser.

## Prerequisites

To run this application locally, you need the following files in the same directory:

1. `index.html` (The application interface)
2. `worker.js` (The background processing script)
3. `pdfium.js` (Emscripten glue code for PDFium)
4. `pdfium.wasm` (Compiled WebAssembly module)

**Note:** You must obtain a compatible build of `pdfium.js` and `pdfium.wasm`. This project is designed to work with standard Emscripten builds of PDFium. The binaries in this repo were downloaded from the [pdfium-binaries repo](https://github.com/bblanchon/pdfium-binaries?tab=readme-ov-file). 

## Installation & Usage

1. **Download Files:** Ensure all four files listed above are in a single folder.
2. **Serve Locally:**
   Due to browser security restrictions (CORS and Web Worker policies), you cannot simply open `index.html` by double-clicking it. You must serve the folder over HTTP.

   **Using Python 3:**
   ```bash
   python -m http.server 8000
   ```

   **Using Node.js (http-server):**
   ```bash
   npx http-server .
   ```

   **Using VS Code:**
   Install the "Live Server" extension and click "Go Live".

3. **Open in Browser:** Navigate to `http://localhost:8000` (or the port provided by your server).
4. **Process PDF:** Drag a PDF file onto the drop zone, adjust settings, and click "Enhance PDF".

## Technical Details

* **Engine:** PDFium (Google's open-source PDF rendering engine) compiled to WebAssembly.
* **Implementation:**
  * Uses `worker.js` to offload heavy processing from the main UI thread.
  * Implements a worker pool to utilize multiple CPU cores for batch processing.
  * Implements direct memory access (HEAPF32/HEAPU8) to interface with the raw C-API of PDFium (`FPDFPage_GetMediaBox`, `FPDFPage_SetMediaBox`).
  * Bypasses high-level JS wrappers to ensure compatibility with raw/minimal WASM builds.
  * **Memory Management:** Manually handles `malloc` and `free` for C-structs and float arrays within the WASM heap to prevent memory leaks during batch operations.

## Testing

This project uses **Playwright** for end-to-end integration testing. The tests spin up a local server, launch a headless browser, and verify the full PDF processing pipeline.

1. **Install Dependencies:**
   ```bash
   npm install
   ```
2. **Run Tests:**
   ```bash
   npx playwright test
   ```

## Troubleshooting

* **"Initializing..." hangs:** Ensure `pdfium.wasm` is in the same directory and is being served with the correct MIME type (`application/wasm`).
* **"Save function not found":** The application automatically falls back to a raw C-API implementation (`FPDF_SaveAsCopy`) if high-level helper functions are missing from the `pdfium.js` wrapper.

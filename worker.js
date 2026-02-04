/**
 * worker.js - Handles PDF processing using PDFium WASM
 * Updated to support Configurable Margins (Side & Size) via Raw API
 */

self.Module = {
    onRuntimeInitialized: function() {
        if (!pdfiumModule) {
            pdfiumModule = self.Module;
            self.postMessage({ type: 'READY' });
        }
    },
    locateFile: path => path,
    print: text => console.log(`PDFium: ${text}`),
    printErr: text => console.error(`PDFium Error: ${text}`)
};

try {
    importScripts('pdfium.js');
} catch (e) {
    self.postMessage({ type: 'ERROR', data: "Could not load pdfium.js." });
}

let pdfiumModule = null;

const initPdfium = async () => {
    if (pdfiumModule) return pdfiumModule;

    if (self.Module && self.Module.asm) {
        pdfiumModule = self.Module;
        return pdfiumModule;
    }

    const factoryNames = ['createPdfium', 'pdfium', 'PDFiumModule'];
    for (const name of factoryNames) {
        if (typeof self[name] === 'function') {
            pdfiumModule = await self[name](self.Module);
            return pdfiumModule;
        }
    }

    if (self.Module) {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const check = setInterval(() => {
                if (self.Module.asm || attempts > 50) {
                    clearInterval(check);
                    if (self.Module.asm) {
                        pdfiumModule = self.Module;
                        resolve(pdfiumModule);
                    } else {
                        reject(new Error("Timeout waiting for Module.asm"));
                    }
                }
                attempts++;
            }, 100);
        });
    }
    throw new Error("No PDFium module found.");
};

// ----------------------------------------------------------------------
// HELPER: Raw Margin Application
// ----------------------------------------------------------------------
const applyMarginsRaw = (pdfium, page, marginSize, side, pageIndex) => {
    // 1. Locate Raw C Functions
    const getMediaBox = pdfium.FPDFPage_GetMediaBox || pdfium._FPDFPage_GetMediaBox;
    const setMediaBox = pdfium.FPDFPage_SetMediaBox || pdfium._FPDFPage_SetMediaBox;

    if (!getMediaBox || !setMediaBox) {
        console.warn("Raw MediaBox functions not found. Margins cannot be applied.");
        return;
    }

    // 2. Allocate memory for 4 floats (Left, Bottom, Right, Top)
    const floatPtrs = pdfium._malloc(16);
    
    const pL = floatPtrs;
    const pB = floatPtrs + 4;
    const pR = floatPtrs + 8;
    const pT = floatPtrs + 12;

    // 3. Get current box
    const success = getMediaBox(page, pL, pB, pR, pT);
    
    if (success) {
        // 4. Read values from WASM Heap (HEAPF32)
        const L = pdfium.HEAPF32[pL >> 2];
        const B = pdfium.HEAPF32[pB >> 2];
        const R = pdfium.HEAPF32[pR >> 2];
        const T = pdfium.HEAPF32[pT >> 2];

        // 5. Calculate new boundaries based on side
        let newL = L;
        let newR = R;
        let applyRight = false;

        if (side === 'right') {
            applyRight = true;
        } else if (side === 'left') {
            applyRight = false;
        } else if (side === 'alternating') {
            // Index 0 (Page 1) is usually Recto (Right side) -> Needs Right margin (Outer)
            // Index 1 (Page 2) is usually Verso (Left side) -> Needs Left margin (Outer)
            applyRight = (pageIndex % 2 === 0);
        }

        if (applyRight) {
            newR = R + marginSize;
        } else {
            // Extending to the left means moving the left boundary negative relative to current origin
            newL = L - marginSize;
        }

        // 6. Set new box
        setMediaBox(page, newL, B, newR, T);
        
        // Also update CropBox to match MediaBox if possible, to ensure viewers display it
        const setCropBox = pdfium.FPDFPage_SetCropBox || pdfium._FPDFPage_SetCropBox;
        if (setCropBox) {
            setCropBox(page, newL, B, newR, T);
        }
    }

    // 7. Free memory
    pdfium._free(floatPtrs);
};

// ----------------------------------------------------------------------
// HELPER: Manually implement FPDF_SaveAsCopy
// ----------------------------------------------------------------------
const saveViaRawAPI = (pdfium, doc) => {
    if (!pdfium.addFunction) {
        throw new Error("Missing 'addFunction'. Cannot save via raw API.");
    }

    const dataChunks = [];
    
    const writeBlock = (pThis, pData, size) => {
        const chunk = pdfium.HEAPU8.slice(pData, pData + size);
        dataChunks.push(chunk);
        return 1; 
    };

    const writeBlockPtr = pdfium.addFunction(writeBlock, 'iiii');
    const fileWritePtr = pdfium._malloc(8);
    
    pdfium.HEAP32[fileWritePtr >> 2] = 1;
    pdfium.HEAP32[(fileWritePtr + 4) >> 2] = writeBlockPtr;

    const saveFunc = pdfium.FPDF_SaveAsCopy || pdfium._FPDF_SaveAsCopy;
    if (!saveFunc) throw new Error("FPDF_SaveAsCopy function not exported.");

    const success = saveFunc(doc, fileWritePtr, 0);

    pdfium._free(fileWritePtr);
    pdfium.removeFunction(writeBlockPtr);

    if (!success) throw new Error("FPDF_SaveAsCopy returned false.");

    const totalLength = dataChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of dataChunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
};


initPdfium().then(() => self.postMessage({ type: 'READY' })).catch(console.error);

self.onmessage = async (e) => {
    const { type, data, config } = e.data;

    if (type === 'PROCESS_PDF') {
        let fileBufferPtr = null;
        let doc = null;
        
        try {
            const pdfium = await initPdfium();
            const inputData = new Uint8Array(data);

            // --- LOAD ---
            const fileLength = inputData.length;
            const malloc = pdfium._malloc || pdfium.malloc;
            const free = pdfium._free || pdfium.free;

            if (!malloc) throw new Error("WASM malloc function not found.");

            fileBufferPtr = malloc(fileLength);
            pdfium.HEAPU8.set(inputData, fileBufferPtr);

            if (pdfium.FPDF_LoadMemDocument) {
                doc = pdfium.FPDF_LoadMemDocument(fileBufferPtr, fileLength, "");
            } else if (pdfium._FPDF_LoadMemDocument) {
                doc = pdfium._FPDF_LoadMemDocument(fileBufferPtr, fileLength, "");
            } else {
                 throw new Error("FPDF_LoadMemDocument not found.");
            }

            if (!doc) throw new Error("FPDF_LoadMemDocument returned null.");

            // --- PROCESS ---
            const getPageCount = pdfium.FPDF_GetPageCount || pdfium._FPDF_GetPageCount;
            const loadPage = pdfium.FPDF_LoadPage || pdfium._FPDF_LoadPage;
            const closePage = pdfium.FPDF_ClosePage || pdfium._FPDF_ClosePage;
            
            const pageCount = getPageCount(doc);
            
            // Config extraction
            const marginSize = config?.marginSize || 150;
            const side = config?.side || 'right'; // 'right', 'left', 'alternating'

            for (let i = 0; i < pageCount; i++) {
                const page = loadPage(doc, i);
                
                // Use Raw helper
                applyMarginsRaw(pdfium, page, marginSize, side, i);

                closePage(page);
            }

            // --- SAVE ---
            let resultBytes = null;
            
            if (pdfium.saveDocument) {
                resultBytes = pdfium.saveDocument(doc);
            } else {
                resultBytes = saveViaRawAPI(pdfium, doc);
            }

            // --- CLEANUP ---
            const closeDoc = pdfium.FPDF_CloseDocument || pdfium._FPDF_CloseDocument;
            closeDoc(doc);
            if (fileBufferPtr) free(fileBufferPtr);

            if (resultBytes) {
                self.postMessage({ type: 'COMPLETE', data: resultBytes }, [resultBytes.buffer]);
            } else {
                throw new Error("Saved data was empty.");
            }

        } catch (err) {
            if (fileBufferPtr && pdfiumModule && pdfiumModule._free) pdfiumModule._free(fileBufferPtr);
            self.postMessage({ type: 'ERROR', data: err.message });
            console.error(err);
        }
    }
};
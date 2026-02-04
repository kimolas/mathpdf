/**
 * worker.js - Handles PDF processing using PDFium WASM
 * Focused core processing only.
 */

self.Module = {
    onRuntimeInitialized: function() {
        if (!pdfiumModule) {
            pdfiumModule = self.Module;
            initializeLibrary(pdfiumModule);
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

const initializeLibrary = (module) => {
    const init = module.FPDF_InitLibrary || module._FPDF_InitLibrary;
    if (init) init();
};

const getHeap = (module, type) => {
    const heap = module[type] || self[type];
    if (!heap && module.wasmMemory) {
        if (type === 'HEAPU8') return new Uint8Array(module.wasmMemory.buffer);
        if (type === 'HEAP32') return new Int32Array(module.wasmMemory.buffer);
        if (type === 'HEAPF32') return new Float32Array(module.wasmMemory.buffer);
    }
    return heap;
};

const initPdfium = async () => {
    if (pdfiumModule) return pdfiumModule;

    const factoryNames = ['createPdfium', 'pdfium', 'PDFiumModule'];
    for (const name of factoryNames) {
        if (typeof self[name] === 'function') {
            pdfiumModule = await self[name](self.Module);
            initializeLibrary(pdfiumModule);
            return pdfiumModule;
        }
    }

    if (self.Module && (self.Module.asm || self.Module._FPDF_InitLibrary)) {
        pdfiumModule = self.Module;
        initializeLibrary(pdfiumModule);
        return pdfiumModule;
    }

    throw new Error("No PDFium module found.");
};

const applyMarginsRaw = (pdfium, page, marginSize, side, pageIndex) => {
    const getMediaBox = pdfium.FPDFPage_GetMediaBox || pdfium._FPDFPage_GetMediaBox;
    const setMediaBox = pdfium.FPDFPage_SetMediaBox || pdfium._FPDFPage_SetMediaBox;
    const setCropBox = pdfium.FPDFPage_SetCropBox || pdfium._FPDFPage_SetCropBox;

    const floatPtrs = pdfium._malloc(16);
    const success = getMediaBox(page, floatPtrs, floatPtrs + 4, floatPtrs + 8, floatPtrs + 12);
    
    if (success) {
        const heapF32 = getHeap(pdfium, 'HEAPF32');
        const L = heapF32[floatPtrs >> 2];
        const B = heapF32[(floatPtrs + 4) >> 2];
        const R = heapF32[(floatPtrs + 8) >> 2];
        const T = heapF32[(floatPtrs + 12) >> 2];

        const applyRight = (side === 'right') || (side === 'alternating' && pageIndex % 2 === 0);
        const newL = applyRight ? L : L - marginSize;
        const newR = applyRight ? R + marginSize : R;

        setMediaBox(page, newL, B, newR, T);
        if (setCropBox) setCropBox(page, newL, B, newR, T);
    }

    pdfium._free(floatPtrs);
};

const saveViaRawAPI = (pdfium, doc) => {
    const dataChunks = [];
    const writeBlock = (pThis, pData, size) => {
        const heapU8 = getHeap(pdfium, 'HEAPU8');
        const chunk = heapU8.slice(pData, pData + size);
        dataChunks.push(chunk);
        return 1;
    };

    if (!pdfium.addFunction) throw new Error("addFunction missing.");
    
    const writeBlockPtr = pdfium.addFunction(writeBlock, 'iiii');
    const fileWritePtr = pdfium._malloc(8);
    const heap32 = getHeap(pdfium, 'HEAP32');
    
    heap32[fileWritePtr >> 2] = 1;
    heap32[(fileWritePtr + 4) >> 2] = writeBlockPtr;

    const saveFunc = pdfium.FPDF_SaveAsCopy || pdfium._FPDF_SaveAsCopy;
    const success = saveFunc(doc, fileWritePtr, 0);

    pdfium._free(fileWritePtr);
    pdfium.removeFunction(writeBlockPtr);

    if (!success) throw new Error("FPDF_SaveAsCopy failed.");

    const totalLength = dataChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of dataChunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
};

self.onmessage = async (e) => {
    const { type, data, config } = e.data;
    
    try {
        const pdfium = await initPdfium();
        const inputData = new Uint8Array(data);

        const loadDoc = (bytes) => {
            const ptr = pdfium._malloc(bytes.length);
            const heapU8 = getHeap(pdfium, 'HEAPU8');
            heapU8.set(bytes, ptr);
            
            const loader = pdfium.FPDF_LoadMemDocument || pdfium._FPDF_LoadMemDocument;
            const doc = loader(ptr, bytes.length, 0); 
            return { doc, ptr };
        };

        if (type === 'PROCESS_PDF') {
            const { doc, ptr } = loadDoc(inputData);
            if (!doc) throw new Error("FPDF_LoadMemDocument failed.");

            const getPageCount = pdfium.FPDF_GetPageCount || pdfium._FPDF_GetPageCount;
            const count = getPageCount(doc);
            
            for (let i = 0; i < count; i++) {
                const loadPage = pdfium.FPDF_LoadPage || pdfium._FPDF_LoadPage;
                const page = loadPage(doc, i);
                applyMarginsRaw(pdfium, page, config.marginSize, config.side, i);
                (pdfium.FPDF_ClosePage || pdfium._FPDF_ClosePage)(page);
            }
            
            const res = saveViaRawAPI(pdfium, doc);
            (pdfium.FPDF_CloseDocument || pdfium._FPDF_CloseDocument)(doc);
            pdfium._free(ptr);
            
            self.postMessage({ type: 'COMPLETE', data: res }, [res.buffer]);
        }
    } catch (err) {
        self.postMessage({ type: 'ERROR', data: err.message || "Unknown Worker Error" });
    }
};
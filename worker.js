/**
 * worker.js - Handles PDF processing using PDFium WASM
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

const getTightContentBounds = (pdfium, page, origL, origB, origR, origT, bitmapBuffer, maxBitmapDim) => {
    // --- CONFIGURATION ---
    const THRESHOLD = 250;   // 0-255. Pixels lighter than this are considered "white".
    // ---------------------

    // Normalize coordinates to ensure positive width/height and correct origin
    const normL = Math.min(origL, origR);
    const normR = Math.max(origL, origR);
    const normB = Math.min(origB, origT);
    const normT = Math.max(origB, origT);
    const normW = normR - normL;
    const normH = normT - normB;

    // Calculate Scale to fit within maxBitmapDim (handles both huge pages and tiny inch-unit pages)
    const maxDim = Math.max(normW, normH);
    let SCALE = 1.0;
    if (maxDim > 0) {
        SCALE = maxBitmapDim / maxDim;
    }

    // Ensure integer dimensions for the bitmap
    const bmWidth = Math.ceil(normW * SCALE);
    const bmHeight = Math.ceil(normH * SCALE);

    if (bmWidth <= 0 || bmHeight <= 0) {
        return { L: origL, B: origB, R: origR, T: origT, isEmpty: true };
    }

    // PDFium Rendering Functions
    const createBitmapEx = pdfium.FPDFBitmap_CreateEx || pdfium._FPDFBitmap_CreateEx;
    const fillRect = pdfium.FPDFBitmap_FillRect || pdfium._FPDFBitmap_FillRect;
    const renderPageBitmap = pdfium.FPDF_RenderPageBitmap || pdfium._FPDF_RenderPageBitmap;
    const getStride = pdfium.FPDFBitmap_GetStride || pdfium._FPDFBitmap_GetStride;
    const destroyBitmap = pdfium.FPDFBitmap_Destroy || pdfium._FPDFBitmap_Destroy;

    // 1. Create Bitmap wrapping our pre-allocated buffer
    // Format 4 = BGRA. Stride = width * 4 bytes.
    const stride = bmWidth * 4;
    const bitmap = createBitmapEx(bmWidth, bmHeight, 4, bitmapBuffer, stride);
    
    if (!bitmap) {
        throw new Error(`Failed to create bitmap (${bmWidth}x${bmHeight})`);
    }

    // 2. Fill with White Background (0xFFFFFFFF) to ensure transparency doesn't look "black"
    fillRect(bitmap, 0, 0, bmWidth, bmHeight, 0xFFFFFFFF);

    // 3. Render Page content into the bitmap
    // Flags: 0x10 (Printing/High Quality) | 0x01 (Annotations)
    renderPageBitmap(bitmap, page, 0, 0, bmWidth, bmHeight, 0, 0x10);

    // 4. Get direct access to pixel data
    // We use our pre-allocated buffer pointer directly
    const ptr = bitmapBuffer >>> 0; 
    const heapU8 = getHeap(pdfium, 'HEAPU8');

    let minX = bmWidth, maxX = -1;
    let minY = -1, maxY = -1;

    // 5. Scan Pixels (Optimized)
    
    // A. Find Top (minY) - Scan rows from top
    for (let y = 0; y < bmHeight; y++) {
        const rowOffset = ptr + (y * stride);
        for (let x = 0; x < bmWidth; x++) {
            const px = rowOffset + (x * 4); // 4 bytes per pixel (BGRA)
            if (heapU8[px] < THRESHOLD || heapU8[px+1] < THRESHOLD || heapU8[px+2] < THRESHOLD) {
                minY = y;
                break; // Found top edge, stop scanning this row and previous rows
            }
        }
        if (minY !== -1) break;
    }

    // B. Find Bottom (maxY) - Scan rows from bottom
    if (minY !== -1) {
        for (let y = bmHeight - 1; y >= minY; y--) {
            const rowOffset = ptr + (y * stride);
            for (let x = 0; x < bmWidth; x++) {
                const px = rowOffset + (x * 4);
                if (heapU8[px] < THRESHOLD || heapU8[px+1] < THRESHOLD || heapU8[px+2] < THRESHOLD) {
                    maxY = y;
                    break; // Found bottom edge
                }
            }
            if (maxY !== -1) break;
        }

        // C. Find Left/Right (minX, maxX) - Scan only content rows
        for (let y = minY; y <= maxY; y++) {
            const rowOffset = ptr + (y * stride);
            
            // Scan from Left (only up to current minX)
            for (let x = 0; x < minX; x++) {
                const px = rowOffset + (x * 4);
                if (heapU8[px] < THRESHOLD || heapU8[px+1] < THRESHOLD || heapU8[px+2] < THRESHOLD) {
                    minX = x;
                    break;
                }
            }

            // Scan from Right (only down to current maxX)
            for (let rx = bmWidth - 1; rx > maxX; rx--) {
                const rpx = rowOffset + (rx * 4);
                if (heapU8[rpx] < THRESHOLD || heapU8[rpx+1] < THRESHOLD || heapU8[rpx+2] < THRESHOLD) {
                    maxX = rx;
                    break;
                }
            }
        }
    }

    // 6. Cleanup Memory
    destroyBitmap(bitmap); // Destroys the struct, but leaves our buffer intact for reuse

    // 7. Handle Empty Page
    if (minY === -1) {
        const midX = (origL + origR) / 2;
        const midY = (origB + origT) / 2;
        return { L: midX, B: midY, R: midX, T: midY, isEmpty: true };
    }

    // 8. Convert Bitmap Coordinates (Pixels) back to PDF Coordinates (Points)
    // Note: Bitmap (0,0) is Top-Left. PDF (L,B) is typically Bottom-Left.
    
    // X axis (Left to Right)
    const newL = normL + (minX / SCALE);
    const newR = normL + ((maxX + 1) / SCALE); // +1 to capture the full pixel width

    // Y axis (Top to Bottom in Bitmap -> Top to Bottom in PDF Space)
    // origT corresponds to y=0.
    const newT = normT - (minY / SCALE);
    const newB = normT - ((maxY + 1) / SCALE);

    return { L: newL, B: newB, R: newR, T: newT, isEmpty: false };
};

const getPageBox = (pdfium, page, floatPtrs) => {
    const getMediaBox = pdfium.FPDFPage_GetMediaBox || pdfium._FPDFPage_GetMediaBox;
    const getCropBox = pdfium.FPDFPage_GetCropBox || pdfium._FPDFPage_GetCropBox;
    const getPageWidth = pdfium.FPDF_GetPageWidth || pdfium._FPDF_GetPageWidth;
    const getPageHeight = pdfium.FPDF_GetPageHeight || pdfium._FPDF_GetPageHeight;

    let box = null;
    // Try MediaBox first, then CropBox as fallback
    if (getMediaBox(page, floatPtrs, floatPtrs + 4, floatPtrs + 8, floatPtrs + 12) ||
        getCropBox(page, floatPtrs, floatPtrs + 4, floatPtrs + 8, floatPtrs + 12)) {
        
        const heapF32 = getHeap(pdfium, 'HEAPF32');
        box = {
            L: heapF32[floatPtrs >>> 2],
            B: heapF32[(floatPtrs + 4) >>> 2],
            R: heapF32[(floatPtrs + 8) >>> 2],
            T: heapF32[(floatPtrs + 12) >>> 2]
        };
    } else if (getPageWidth && getPageHeight) {
        // Fallback: Use high-level API if raw box retrieval fails
        const w = getPageWidth(page);
        const h = getPageHeight(page);
        if (w > 0 && h > 0) {
            box = { L: 0, B: 0, R: w, T: h };
        }
    }
    return box;
};

const applyMarginsRaw = (pdfium, page, config, pageIndex, floatPtrs, overrideBounds = null, uniformDims = null) => {
    const setMediaBox = pdfium.FPDFPage_SetMediaBox || pdfium._FPDFPage_SetMediaBox;
    const setCropBox = pdfium.FPDFPage_SetCropBox || pdfium._FPDFPage_SetCropBox;

    let box = getPageBox(pdfium, page, floatPtrs);
    if (box) {
        let { L, B, R, T } = box;
        // Capture original page dimensions for relative positioning
        const origB = B;
        const origT = T;

        let newL, newR, newB, newT;

        if (config.tablet) {
            // Tablet Optimization Mode
            if (overrideBounds) {
                L = overrideBounds.L;
                R = overrideBounds.R;
                B = overrideBounds.B;
                T = overrideBounds.T;
            }

            const { epsilon = 0 } = config.tablet;
            
            // Use uniform dimensions if provided, otherwise calculate per-page (legacy behavior)
            let newHeight, newWidth;
            if (uniformDims) {
                newHeight = uniformDims.height;
                newWidth = uniformDims.width;
            } else {
                const { width: wd, height: hd } = config.tablet;
                const hp = T - B;
                const targetRatio = wd / hd;
                newHeight = hp + (epsilon * 2);
                newWidth = newHeight * targetRatio;
            }

            // Vertical Alignment: Proportional based on original position
            // This respects preexisting top/bottom justification (e.g. end of chapter text stays at top)
            const contentCy = (T + B) / 2;
            const origHeight = origT - origB;
            const safeOrigHeight = origHeight > 0 ? origHeight : 1;
            
            // Calculate normalized position (0.0 = bottom, 1.0 = top)
            const ratio = (contentCy - origB) / safeOrigHeight;

            // Calculate tentative new Bottom based on ratio
            let tentativeB = contentCy - (ratio * newHeight);
            let tentativeT = tentativeB + newHeight;

            // Clamp to ensure epsilon margins (content doesn't touch edge)
            const minT = T + epsilon;
            const maxB = B - epsilon;

            if (tentativeT < minT) {
                const shift = minT - tentativeT;
                tentativeT += shift;
                tentativeB += shift;
            } else if (tentativeB > maxB) {
                const shift = tentativeB - maxB;
                tentativeB -= shift;
                tentativeT -= shift;
            }

            newB = tentativeB;
            newT = tentativeT;

            // Horizontal Alignment
            const side = config.side || 'right';
            const applyRight = (side === 'right') || (side === 'alternating' && pageIndex % 2 === 0);

            if (applyRight) {
                // Margin on Right -> Content aligned to Left
                // Add epsilon padding to Left so content doesn't touch bezel
                newL = L - epsilon;
                newR = newL + newWidth;
            } else {
                // Margin on Left -> Content aligned to Right
                // Add epsilon padding to Right
                newR = R + epsilon;
                newL = newR - newWidth;
            }
        } else {
            const marginSize = config.marginSize || 0;
            const side = config.side || 'right';
            newB = B;
            newT = T;
            const applyRight = (side === 'right') || (side === 'alternating' && pageIndex % 2 === 0);
            newL = applyRight ? L : L - marginSize;
            newR = applyRight ? R + marginSize : R;
        }

        // Validate coordinates to prevent corrupt PDF (NaN/Infinity/Huge)
        const isValid = (v) => Number.isFinite(v) && Math.abs(v) < 1e7;

        if (isValid(newL) && isValid(newB) && isValid(newR) && isValid(newT)) {
            setMediaBox(page, newL, newB, newR, newT);
            if (setCropBox) setCropBox(page, newL, newB, newR, newT);
        }
    }
};

const saveViaRawAPI = (pdfium, doc) => {
    const dataChunks = [];
    const writeBlock = (pThis, pData, size) => {
        const heapU8 = getHeap(pdfium, 'HEAPU8');
        // Ensure pData is treated as unsigned for large memory offsets
        const start = pData >>> 0;
        const chunk = heapU8.slice(start, start + size);
        dataChunks.push(chunk);
        return 1;
    };

    if (!pdfium.addFunction) throw new Error("addFunction missing.");
    
    const writeBlockPtr = pdfium.addFunction(writeBlock, 'iiii');
    const fileWritePtr = pdfium._malloc(8);
    const heap32 = getHeap(pdfium, 'HEAP32');
    
    // Use unsigned shift to handle potential large pointers safely
    heap32[fileWritePtr >>> 2] = 1;
    heap32[(fileWritePtr + 4) >>> 2] = writeBlockPtr;

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

        // Sanitize configuration to ensure numbers (prevents string concatenation bugs)
        if (config.tablet) {
            config.tablet.width = parseFloat(config.tablet.width);
            config.tablet.height = parseFloat(config.tablet.height);
            config.tablet.epsilon = parseFloat(config.tablet.epsilon || 0);

            // Validate dimensions to prevent Infinity/NaN
            if (!Number.isFinite(config.tablet.width) || config.tablet.width <= 0) config.tablet.width = 1000;
            if (!Number.isFinite(config.tablet.height) || config.tablet.height <= 0) config.tablet.height = 1000;
            if (!Number.isFinite(config.tablet.epsilon)) config.tablet.epsilon = 0;
        }
        if (config.marginSize) config.marginSize = parseFloat(config.marginSize) || 0;

        const loadDoc = (bytes) => {
            const ptr = pdfium._malloc(bytes.length);
            const heapU8 = getHeap(pdfium, 'HEAPU8');
            heapU8.set(bytes, ptr >>> 0);
            
            const loader = pdfium.FPDF_LoadMemDocument || pdfium._FPDF_LoadMemDocument;
            const doc = loader(ptr, bytes.length, 0); 
            return { doc, ptr };
        };

        if (type === 'PROCESS_PDF') {
            let { doc, ptr } = loadDoc(inputData);
            if (!doc) throw new Error("FPDF_LoadMemDocument failed.");

            const getPageCount = pdfium.FPDF_GetPageCount || pdfium._FPDF_GetPageCount;
            const count = getPageCount(doc);
            
            // Pre-allocate buffer for page box retrieval to prevent heap fragmentation
            const floatPtrs = pdfium._malloc(16);
            if (!floatPtrs) throw new Error("Failed to allocate memory for page processing.");

            // Pre-allocate a single large bitmap buffer to reuse for all pages
            // Align to 16 bytes to prevent SIMD crashes in PDFium
            const MAX_BITMAP_DIM = 1000;
            const BITMAP_BUFFER_SIZE = (MAX_BITMAP_DIM * MAX_BITMAP_DIM * 4) + 16; 
            const rawBitmapBuffer = pdfium._malloc(BITMAP_BUFFER_SIZE);
            const bitmapBuffer = (rawBitmapBuffer + 15) & ~15; // Align pointer

            if (config.tablet) {
                // Two-Pass Approach for Uniformity
                
                // Pass 1: Analyze all pages to find content bounds
                const pageBounds = new Array(count);
                const loadPage = pdfium.FPDF_LoadPage || pdfium._FPDF_LoadPage;
                const closePage = pdfium.FPDF_ClosePage || pdfium._FPDF_ClosePage;

                for (let i = 0; i < count; i++) {
                    const page = loadPage(doc, i);
                    if (page) {
                        const box = getPageBox(pdfium, page, floatPtrs);
                        if (box) {
                            pageBounds[i] = getTightContentBounds(pdfium, page, box.L, box.B, box.R, box.T, bitmapBuffer, MAX_BITMAP_DIM);
                        } else {
                            pageBounds[i] = { isEmpty: true, L:0, B:0, R:0, T:0 }; // Fallback
                        }
                        closePage(page);
                    } else {
                        console.warn(`Failed to load page ${i}`);
                        pageBounds[i] = { isEmpty: true, L:0, B:0, R:0, T:0 };
                    }
                }

                // Calculate Typical Dimensions (Median Height)
                const contentHeights = pageBounds
                    .filter(b => !b.isEmpty)
                    .map(b => b.T - b.B);
                
                contentHeights.sort((a, b) => a - b);
                
                let typicalContentHeight = 0;
                if (contentHeights.length > 0) {
                    const mid = Math.floor(contentHeights.length / 2);
                    typicalContentHeight = contentHeights[mid];
                } else {
                    typicalContentHeight = 500; // Fallback
                }

                // Config is already sanitized above
                let { width: wd, height: hd, epsilon } = config.tablet;
                
                // Heuristic: If page is in points (>200) but epsilon is small (<5), assume inches and convert.
                if (typicalContentHeight > 200 && epsilon > 0 && epsilon < 5) {
                    epsilon *= 72;
                }

                const targetRatio = wd / hd;

                // Calculate base dimensions for a "typical" page
                const basePageHeight = typicalContentHeight + (epsilon * 2);
                const basePageWidth = basePageHeight * targetRatio;

                // Pass 2: Apply Margins using Adaptive Dimensions
                for (let i = 0; i < count; i++) {
                    const page = loadPage(doc, i);
                    if (page) {
                        const bounds = pageBounds[i];
                        const contentH = bounds.isEmpty ? 0 : bounds.T - bounds.B;
                        const contentW = bounds.isEmpty ? 0 : bounds.R - bounds.L;

                        // 1. Height: At least base height, but expand for long content (outliers)
                        let pageHeight = Math.max(basePageHeight, contentH + (epsilon * 2));
                        
                        // 2. Width: Fixed to base width to ensure uniform zoom/font size, 
                        // unless content is wider than the target width
                        const pageWidth = Math.max(basePageWidth, contentW + (epsilon * 2));

                        // 3. Aspect Ratio Correction:
                        // If the page is wider than the target ratio (relative to height), 
                        // expand height to maintain the ratio. This prevents side cropping.
                        if (pageWidth / pageHeight > targetRatio) {
                            pageHeight = pageWidth / targetRatio;
                        }

                        const dims = { width: pageWidth, height: pageHeight };

                        applyMarginsRaw(pdfium, page, config, i, floatPtrs, bounds, dims);
                        closePage(page);
                    }
                }

            } else {
                // Standard Fixed Margin Mode (Single Pass)
                for (let i = 0; i < count; i++) {
                    const loadPage = pdfium.FPDF_LoadPage || pdfium._FPDF_LoadPage;
                    const page = loadPage(doc, i);
                    if (page) {
                        applyMarginsRaw(pdfium, page, config, i, floatPtrs);
                        (pdfium.FPDF_ClosePage || pdfium._FPDF_ClosePage)(page);
                    }
                }
            }

            pdfium._free(floatPtrs);
            pdfium._free(rawBitmapBuffer);
            
            const res = saveViaRawAPI(pdfium, doc);
            (pdfium.FPDF_CloseDocument || pdfium._FPDF_CloseDocument)(doc);
            pdfium._free(ptr);
            
            self.postMessage({ type: 'COMPLETE', data: res }, [res.buffer]);
        }
    } catch (err) {
        self.postMessage({ type: 'ERROR', data: err.message || "Unknown Worker Error" });
    }
};
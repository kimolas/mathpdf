const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test.describe('PDF Enhancer E2E', () => {
  const testPdfPath = path.join(__dirname, 'test.pdf');

  test.beforeAll(() => {
    // Create a minimal valid PDF for testing
    const pdfContent = `%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>
endobj
xref
0 4
0000000000 65535 f
0000000010 00000 n
0000000060 00000 n
0000000117 00000 n
trailer
<< /Size 4 /Root 1 0 R >>
startxref
205
%%EOF`;
    fs.writeFileSync(testPdfPath, pdfContent);
  });

  test.afterAll(() => {
    if (fs.existsSync(testPdfPath)) {
      fs.unlinkSync(testPdfPath);
    }
  });

  test('should load the page and have correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/PDF Margin Enhancer/);
  });

  test('should upload PDF and trigger download', async ({ page }) => {
    await page.goto('/');

    // Setup download listener
    const downloadPromise = page.waitForEvent('download');

    // Upload file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testPdfPath);

    // Click enhance
    const enhanceBtn = page.locator('#enhanceBtn');
    await expect(enhanceBtn).toBeEnabled();
    await enhanceBtn.click();

    // Verify download
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('enhanced_test.pdf');
  });
});
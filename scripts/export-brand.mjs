/** Export web-sized copies of the logo without changing its design or transparency. */
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const source = new URL('../docs/brand/codes-mark-source.png', import.meta.url);
const output = new URL('../public/brand/', import.meta.url);
const browser = await chromium.launch({
  executablePath: process.env.CODES_CHROME || undefined,
  headless: true,
});
try {
  await mkdir(output, { recursive: true });
  const page = await browser.newPage();
  const input = 'data:image/png;base64,' + (await readFile(source)).toString('base64');
  for (const [filename, size] of [
    ['codes-mark.png', 256],
    ['favicon.png', 64],
  ]) {
    const data = await page.evaluate(
      async ({ input, size }) => {
        const image = new Image();
        image.src = input;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas rendering is unavailable.');
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { input, size },
    );
    const bytes = Buffer.from(data, 'base64');
    await writeFile(new URL(filename, output), bytes);
    console.log(`${filename}: ${size}×${size}, ${bytes.length} bytes`);
  }
} finally {
  await browser.close();
}

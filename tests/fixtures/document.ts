// Minimal synthetic Word document with a single paragraph.
export const sampleDocx = Buffer.from(
  'UEsDBBQAAAAIAI9Sel23ezbv2wAAAGgBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbJWQu04DMRBFe77CcovWs1AghLJJwaMEivABI3t218IveZwQ/p7ZBG1BR2nfM/fYs9mdYlBHquxzGvSN6bWiZLPzaRr0x/6lu9e77dVm/12IlbCJBz23Vh4A2M4UkU0ulCQZc43Y5FgnKGg/cSK47fs7sDk1Sq1rS4eWsica8RCaej7J/UVcKbBWjxdykQ0aSwneYpMcjsn90XS/CiOTZ4ZnX/haAA2ieJMvVe9IvWNtrxilD75ydeCyPURxmIX8lzCPo7e0zi9tpWZLzLKrGMyaRPRpfQicN7f9AVBLAwQUAAAACACPUnpdQct37osAAAD0AAAACwAAAF9yZWxzLy5yZWxzjc87DsIwDAbgnVNEOUBdGBhQ04mla8UFrMRNIpqHEiPg9mRgKIiB0favz/Yw04rsU6zO5yoeYY1VScecTwBVOwpYu5QptsmSSkBuZbGQUV/REhz6/ghla8hxN2xRMRkly2T2Ulyemf7B07J4Teekb4Ei/9jxlWgyFkus5D0VA+bd7horoZ0DH0+OL1BLAwQUAAAACACPUnpds1MwQoIAAACqAAAAEQAAAHdvcmQvZG9jdW1lbnQueG1sNc7BDcMgDAXQe6ZAGaBEPfSAKDt0BErcBAmDZUhoti8g9fLsry9L1lWtyR0IsYgvhphVfc57KaSkzG4HtPmWCGLrPonRlhZ5kzXxSpwc5OzjhkHel+Uh0fo4m0lX9U7rZdqkDneKeR2WC3C4BAUbBTGcHqqWvevykIbjfurb/zvzA1BLAQIUAxQAAAAIAI9Sel23ezbv2wAAAGgBAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQDFAAAAAgAj1J6XUHLd+6LAAAA9AAAAAsAAAAAAAAAAAAAAIABDAEAAF9yZWxzLy5yZWxzUEsBAhQDFAAAAAgAj1J6XbNTMEKCAAAAqgAAABEAAAAAAAAAAAAAAIABwAEAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAADAAMAuQAAAHECAAAAAA==',
  'base64',
);

export function samplePdf() {
  const contents = 'BT /F1 18 Tf 30 100 Td (Quarterly PDF preview) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + contents.length + ' >>\nstream\n' + contents + '\nendstream',
  ];
  let document = '%PDF-1.4\n';
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(document.length);
    document += index + 1 + ' 0 obj\n' + object + '\nendobj\n';
  }
  const xref = document.length;
  document += 'xref\n0 6\n0000000000 65535 f \n';
  for (const offset of offsets) document += String(offset).padStart(10, '0') + ' 00000 n \n';
  return Buffer.from(
    document + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n',
  );
}

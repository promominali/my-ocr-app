
export const downloadAsText = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename.replace('.pdf', '')}_OCR.txt`;
  a.click();
  URL.revokeObjectURL(url);
};

const generateRichHTML = (filename: string, pages: any[]) => {
  const pageHtml = pages.map(p => `
    <div class="page">
      <div class="image-container">
        <img src="${p.imagePreview}" alt="Page ${p.pageNumber}" />
      </div>
      <div class="text-content">
        <h3>Page ${p.pageNumber}</h3>
        <div class="markdown-body">${p.extractedText.replace(/\n/g, '<br/>')}</div>
      </div>
    </div>
  `).join('<hr/>');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${filename} - LensOCR Export</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #334155; max-width: 900px; margin: 0 auto; line-height: 1.6; background: #f8fafc; }
        .page { background: white; padding: 30px; border-radius: 12px; margin-bottom: 40px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); border: 1px solid #e2e8f0; }
        .image-container { text-align: center; margin-bottom: 25px; border-bottom: 1px solid #f1f5f9; padding-bottom: 25px; }
        .image-container img { max-width: 100%; height: auto; border-radius: 4px; box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1); }
        h3 { color: #4f46e5; margin-top: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; }
        .markdown-body { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: 13px; color: #475569; word-break: break-all; }
        hr { border: 0; height: 1px; background: #e2e8f0; margin: 40px 0; }
        @media print {
          body { background: white; padding: 0; }
          .page { box-shadow: none; border: none; margin: 0; page-break-after: always; }
        }
      </style>
    </head>
    <body>
      <h1 style="color: #1e293b; margin-bottom: 8px;">${filename}</h1>
      <p style="color: #64748b; margin-bottom: 40px; font-size: 14px;">Extracted by LensOCR UltraFast</p>
      ${pageHtml}
    </body>
    </html>
  `;
};

export const downloadAsHTML = (filename: string, pages: any[]) => {
  const content = generateRichHTML(filename, pages);
  const blob = new Blob([content], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename.replace('.pdf', '')}_OCR.html`;
  a.click();
  URL.revokeObjectURL(url);
};

export const downloadAsWord = (filename: string, pages: any[]) => {
  const content = generateRichHTML(filename, pages);
  const blob = new Blob([content], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename.replace('.pdf', '')}_OCR.doc`;
  a.click();
  URL.revokeObjectURL(url);
};

export const downloadAsSimplePDF = (filename: string, pages: any[]) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const content = generateRichHTML(filename, pages);
  printWindow.document.write(content);
  printWindow.document.close();
  
  // Wait for images to load before printing
  printWindow.onload = () => {
    printWindow.print();
  };
};

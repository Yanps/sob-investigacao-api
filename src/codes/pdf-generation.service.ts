import { Injectable, Logger } from '@nestjs/common';
import {
  PDFDocument,
  StandardFonts,
  cmyk,
  PDFPage,
} from 'pdf-lib';
import QRCode from 'qrcode';
import JSZip from 'jszip';
import { readFileSync } from 'fs';
import { join } from 'path';

interface CodeWithProduct {
  code: string;
  productId?: string;
}

const DEFAULT_QR_OPTIONS = {
  size: 100,
  margin: 40,
};

@Injectable()
export class PdfGenerationService {
  private readonly logger = new Logger(PdfGenerationService.name);
  private pdfBufferCache = new Map<string, Buffer>();

  /**
   * Maps productId to the correct PDF template filename
   */
  private getTemplateName(productId?: string): string {
    if (!productId) {
      return 'giftcard_flores.pdf';
    }

    const normalized = productId.toLowerCase();
    if (normalized.includes('mosco')) {
      return 'giftcard_mosco.pdf';
    }
    if (normalized.includes('doce')) {
      return 'giftcard_doce.pdf';
    }
    if (normalized.includes('flores') || normalized.includes('fl')) {
      return 'giftcard_flores.pdf';
    }

    // Default to flores
    return 'giftcard_flores.pdf';
  }

  /**
   * Get the base PDF buffer, with caching
   */
  private getBasePdfBuffer(templateName: string): Buffer {
    if (this.pdfBufferCache.has(templateName)) {
      return this.pdfBufferCache.get(templateName)!;
    }

    try {
      const filePath = join(__dirname, 'assets', 'pdfs', templateName);
      const buffer = readFileSync(filePath);
      this.pdfBufferCache.set(templateName, buffer);
      return buffer;
    } catch (error) {
      this.logger.error(
        `Failed to read PDF template: ${templateName}`,
        error,
      );
      throw new Error(
        `PDF template not found: ${templateName}. Tried: ${join(__dirname, 'assets', 'pdfs', templateName)}`,
      );
    }
  }

  /**
   * Draw a QR code as CMYK vector shapes on a PDF page
   */
  private async drawQRCodeAsCMYKShapes(
    page: PDFPage,
    text: string,
    x: number,
    y: number,
    size: number,
  ): Promise<void> {
    const qrMatrix = QRCode.create(text);
    const modules = qrMatrix.modules;
    const moduleCount = modules.size;
    const moduleSize = size / moduleCount;

    // Draw each module as a black rectangle in CMYK
    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (modules.get(row, col)) {
          page.drawRectangle({
            x: x + col * moduleSize,
            y: y + (moduleCount - row - 1) * moduleSize, // Inverts Y axis
            width: moduleSize,
            height: moduleSize,
            color: cmyk(0, 0, 0, 1), // Pure black CMYK
          });
        }
      }
    }
  }

  /**
   * Generate a single PDF with QR code embedded
   */
  async generatePdfWithQr(
    code: string,
    productId?: string,
  ): Promise<Buffer> {
    const templateName = this.getTemplateName(productId);
    const basePdfBuffer = this.getBasePdfBuffer(templateName);

    try {
      const pdfDoc = await PDFDocument.load(basePdfBuffer);
      const pages = pdfDoc.getPages();

      // Check if we have a second page (where QR goes)
      if (pages.length < 2) {
        this.logger.warn(
          `Template ${templateName} has fewer than 2 pages. Adding QR to first page.`,
        );
      }

      const secondPage = pages.length >= 2 ? pages[1] : pages[0];
      const secondPageSize = secondPage.getSize();

      const qrSize = DEFAULT_QR_OPTIONS.size;
      const margin = DEFAULT_QR_OPTIONS.margin;
      const smallQrSize = qrSize * 0.7; // 70% of original size
      const smallMargin = margin * 0.7;

      // Position in bottom-right corner of the page
      const smallQrX =
        secondPageSize.width -
        smallQrSize -
        smallMargin * 2 +
        smallQrSize * 0.16;
      const smallQrY = smallMargin * 2 - smallQrSize * 0.06;

      // Draw QR code as vector shapes
      await this.drawQRCodeAsCMYKShapes(
        secondPage,
        `https://sobinvestigacao.com/pages/ativacao?code=${code}`,
        smallQrX,
        smallQrY,
        smallQrSize,
      );

      // Embed font for text
      const font = await pdfDoc.embedFont(StandardFonts.Courier);

      // Add code text below QR code
      const smallTextSize = 6.5;
      const qrMargin = smallMargin * 0.12;
      const textWidth = font.widthOfTextAtSize(code, smallTextSize);
      const centeredTextX = smallQrX + (smallQrSize - textWidth) / 2;

      secondPage.drawText(code, {
        x: centeredTextX,
        y: smallQrY - smallMargin * 0.12 - smallTextSize,
        size: smallTextSize,
        font,
        color: cmyk(0, 0, 0, 1), // Pure black CMYK
      });

      // Save and return PDF buffer
      const pdfBytes = await pdfDoc.save();
      return Buffer.from(pdfBytes);
    } catch (error) {
      this.logger.error(`Error generating PDF for code ${code}:`, error);
      throw new Error(
        `Failed to generate PDF: ${(error as Error)?.message}`,
      );
    }
  }

  /**
   * Generate a ZIP file containing PDFs for a batch of codes
   */
  async generateBatchZip(codes: CodeWithProduct[]): Promise<Buffer> {
    const zip = new JSZip();

    // Process codes in chunks of 20 for better performance
    const chunkSize = 20;
    for (let i = 0; i < codes.length; i += chunkSize) {
      const chunk = codes.slice(i, i + chunkSize);

      // Process chunk in parallel
      const pdfPromises = chunk.map(({ code, productId }) =>
        this.generatePdfWithQr(code, productId).then((buffer) => ({
          code,
          buffer,
        })),
      );

      const pdfResults = await Promise.all(pdfPromises);

      for (const { code, buffer } of pdfResults) {
        zip.file(`${code}.pdf`, buffer);
      }
    }

    // Generate ZIP buffer
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    return zipBuffer;
  }
}

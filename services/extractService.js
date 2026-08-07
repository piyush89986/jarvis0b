const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────
// Extract text from different file types
// ─────────────────────────────────────────────

// PDF extraction
const extractFromPDF = async (filePathOrBuffer) => {
  const pdfParse = require('pdf-parse');
  let dataBuffer;

  if (typeof filePathOrBuffer === 'string') {
    dataBuffer = fs.readFileSync(filePathOrBuffer);
  } else {
    dataBuffer = filePathOrBuffer;
  }

  const data = await pdfParse(dataBuffer);
  return {
    text: data.text,
    numPages: data.numpages,
    info: data.info,
  };
};

// Word document extraction
const extractFromDOCX = async (filePathOrBuffer) => {
  const mammoth = require('mammoth');
  let result;

  if (typeof filePathOrBuffer === 'string') {
    result = await mammoth.extractRawText({ path: filePathOrBuffer });
  } else {
    result = await mammoth.extractRawText({ buffer: filePathOrBuffer });
  }

  return {
    text: result.value,
    numPages: 1,
    info: {},
  };
};

// Plain text extraction
const extractFromTXT = (filePathOrBuffer) => {
  let text;
  if (typeof filePathOrBuffer === 'string') {
    text = fs.readFileSync(filePathOrBuffer, 'utf-8');
  } else {
    text = filePathOrBuffer.toString('utf-8');
  }

  return { text, numPages: 1, info: {} };
};

// Image OCR extraction
const extractFromImage = async (filePathOrBuffer) => {
  try {
    const Tesseract = require('tesseract.js');
    let imagePath = filePathOrBuffer;

    // If buffer, save to temp file
    if (Buffer.isBuffer(filePathOrBuffer)) {
      const tmpPath = path.join(__dirname, `../tmp/ocr_${Date.now()}.png`);
      fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
      fs.writeFileSync(tmpPath, filePathOrBuffer);
      imagePath = tmpPath;
    }

    const { data: { text } } = await Tesseract.recognize(imagePath, 'eng+hin', {
      logger: () => {}, // suppress logs
    });

    // Cleanup temp file
    if (Buffer.isBuffer(filePathOrBuffer)) {
      fs.unlinkSync(imagePath);
    }

    return { text, numPages: 1, info: {} };
  } catch (error) {
    console.error('OCR error:', error.message);
    return { text: '', numPages: 1, info: {} };
  }
};

// ─────────────────────────────────────────────
// Main extractor — auto-detects file type
// ─────────────────────────────────────────────
const extractText = async (filePathOrBuffer, fileType) => {
  try {
    let result;
    const type = fileType.toLowerCase();

    if (type === 'pdf') {
      result = await extractFromPDF(filePathOrBuffer);
    } else if (type === 'docx' || type === 'doc') {
      result = await extractFromDOCX(filePathOrBuffer);
    } else if (type === 'txt') {
      result = extractFromTXT(filePathOrBuffer);
    } else if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'image'].includes(type)) {
      result = await extractFromImage(filePathOrBuffer);
    } else {
      // Try PDF as default fallback
      try {
        result = await extractFromPDF(filePathOrBuffer);
      } catch {
        result = { text: '', numPages: 0, info: {} };
      }
    }

    // Clean up extracted text
    result.text = cleanText(result.text);
    return result;
  } catch (error) {
    console.error(`Text extraction error [${fileType}]:`, error.message);
    return { text: '', numPages: 0, info: {} };
  }
};

// ─────────────────────────────────────────────
// Text cleaning utility
// ─────────────────────────────────────────────
const cleanText = (text) => {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
    .replace(/[ \t]{2,}/g, ' ') // Collapse multiple spaces
    .replace(/[^\x00-\x7F\u0900-\u097F]/g, '') // Keep ASCII and Devanagari
    .trim();
};

module.exports = {
  extractText,
  extractFromPDF,
  extractFromDOCX,
  extractFromTXT,
  extractFromImage,
  cleanText,
};

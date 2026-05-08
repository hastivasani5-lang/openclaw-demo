// server.js (v2) — Vercel serverless compatible
require('dotenv').config();

const express  = require('express');
const multer   = require('multer');
const mammoth  = require('mammoth');
const cors     = require('cors');

const { processCandidate } = require('./brain.js');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Memory storage — CV never written to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }   // 5 MB
});

// Extract text from uploaded CV (PDF or DOCX)
async function extractCvText(file) {
  if (!file) return '';
  try {
    const name = file.originalname.toLowerCase();

    if (file.mimetype === 'application/pdf' || name.endsWith('.pdf')) {
      // Use pdf-parse safely — dynamic require avoids Vercel build issues
      const pdfParse = require('pdf-parse/lib/pdf-parse.js');
      const data = await pdfParse(file.buffer);
      return (data.text || '').trim();
    }

    if (file.mimetype.includes('word') || name.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      return (result.value || '').trim();
    }

    console.warn('Unsupported CV type:', file.mimetype, file.originalname);
    return '';
  } catch (err) {
    console.error('CV extraction failed:', err.message);
    return '';   // non-fatal — continue without CV text
  }
}

// Single endpoint
app.post('/api/career-apply', upload.single('cv'), async (req, res) => {

  const cvText = await extractCvText(req.file);

  const b = req.body || {};
  const profile = {
    name:           b.full_name || b.name || 'Candidate',
    email:          b.email,
    role:           b.role || 'Developer',
    skills:         b.skills || '',
    cv_text:        cvText.slice(0, 8000),
    resumeBuffer:   req.file ? req.file.buffer       : null,
    resumeFilename: req.file ? req.file.originalname : null,
  };

  if (!profile.email) {
    return res.status(400).json({ error: 'email is required' });
  }

  try {
    const result = await processCandidate(profile);
    res.json(result);
  } catch (err) {
    console.error('ERROR:', err.message);
    // Validation errors (invalid role/skills) → 400, not 500
    const status = err.validationError ? 400 : 500;
    res.status(status).json({ error: err.message });
  }

});

// Local dev server
if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log('=================================');
    console.log('  Sensussoft Demo (v2) running');
    console.log('  http://localhost:' + PORT);
    console.log('=================================');
  });
}

// Vercel serverless export
module.exports = app;

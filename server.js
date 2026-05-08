// server.js (v2) — accepts CV upload alongside form fields
require('dotenv').config();

const express  = require('express');
const multer   = require('multer');
const pdfParse = require('pdf-parse');
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
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      const data = await pdfParse(file.buffer);
      return (data.text || '').trim();
    }
    if (file.mimetype.includes('word') || file.originalname.toLowerCase().endsWith('.docx')) {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      return (result.value || '').trim();
    }
    console.warn('Unsupported CV type:', file.mimetype, file.originalname);
    return '';
  } catch (err) {
    console.error('CV extraction failed:', err.message);
    return '';
  }
}

// Single endpoint — multer parses multipart, then brain runs
app.post('/api/career-apply', upload.single('cv'), async (req, res) => {

  // multer only parses multipart — if JSON was sent, req.body comes from express.json()
  const cvText = await extractCvText(req.file);

  const b = req.body || {};
  const profile = {
    name:           b.full_name || b.name || 'Candidate',
    email:          b.email,
    role:           b.role || 'Developer',
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
    res.status(500).json({ error: err.message });
  }

});

const PORT = 4000;
app.listen(PORT, () => {
  console.log('=================================');
  console.log('  Sensussoft Demo (v2) running');
  console.log('  http://localhost:' + PORT);
  console.log('=================================');
  console.log('Open demo-form.html in your browser.\n');
});

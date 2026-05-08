require('dotenv').config();

const express = require('express');
const multer  = require('multer');
const mammoth = require('mammoth');
const cors    = require('cors');

const { processCandidate } = require('./brain.js');

const app = express();
app.use(cors());

// ── Multer — memory storage, 5MB limit ──────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
});

// ── CV text extraction ───────────────────────────────────────────────────────
async function extractCvText(file) {
  if (!file) return '';
  try {
    const name = (file.originalname || '').toLowerCase();
    if (file.mimetype === 'application/pdf' || name.endsWith('.pdf')) {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(file.buffer);
      return (data.text || '').trim();
    }
    if (file.mimetype.includes('word') || name.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      return (result.value || '').trim();
    }
    return '';
  } catch (err) {
    console.error('CV extraction error:', err.message);
    return '';
  }
}

// ── CV keyword check ─────────────────────────────────────────────────────────
const CV_KEYWORDS = [
  'experience','education','skills','work','employment','project','summary',
  'objective','profile','qualification','certification','university','college',
  'degree','bachelor','master','engineer','developer','intern','job','position',
  'company','organization','responsibilities','worked','developed','designed',
  'managed','led','built','created','resume','curriculum','vitae','cv','career'
];

function looksLikeCV(text) {
  if (!text || text.trim().length < 100) return false;
  const lower = text.toLowerCase();
  return CV_KEYWORDS.filter(k => lower.includes(k)).length >= 3;
}

// ── Role-Skills mismatch check ───────────────────────────────────────────────
const DESIGN_ROLES  = ['designer','ui','ux','visual','graphic','motion','brand'];
const DESIGN_SKILLS = ['figma','sketch','xd','adobe xd','illustrator','photoshop',
                       'wireframe','prototype','invision','zeplin','framer','canva'];
const CODING_SKILLS = ['react','vue','angular','node','python','java','javascript',
                       'typescript','django','flask','express','flutter','swift',
                       'kotlin','php','ruby','go','rust','html','css','sql',
                       'mongodb','postgres','docker','kubernetes','aws','next','nuxt'];

function checkRoleSkillsMismatch(role, skills) {
  const r = (role   || '').toLowerCase();
  const s = (skills || '').toLowerCase();
  const isDesign   = DESIGN_ROLES.some(k  => r.includes(k));
  const hasDesign  = DESIGN_SKILLS.some(k => s.includes(k));
  const hasCoding  = CODING_SKILLS.some(k => s.includes(k));
  if (isDesign && hasCoding && !hasDesign) {
    return `Role mismatch: You selected "${role}" but listed only coding skills (${skills}). ` +
           `A UI/UX Designer should list design tools like Figma, Sketch, or Adobe XD. ` +
           `Did you mean "Frontend Developer" instead?`;
  }
  return null;
}

// ── Main route ───────────────────────────────────────────────────────────────
app.post('/api/career-apply', upload.single('cv'), async (req, res) => {

  // Log for Vercel debugging
  console.log('[career-apply] body:', JSON.stringify(req.body));
  console.log('[career-apply] file:', req.file?.originalname || 'none');

  const b    = req.body || {};
  const name  = (b.full_name || b.name || '').trim();
  const email = (b.email     || '').trim();
  const role  = (b.role      || '').trim();
  const skills = (b.skills   || '').trim();

  // Basic required field check
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }
  if (!role) {
    return res.status(400).json({ error: 'Role is required.' });
  }

  // CV validation
  const cvText = await extractCvText(req.file);

  if (req.file && !cvText) {
    return res.status(400).json({
      error: '❌ Could not read text from the uploaded file. Please upload a text-based PDF or DOCX (not a scanned image).'
    });
  }
  if (req.file && cvText && !looksLikeCV(cvText)) {
    return res.status(400).json({
      error: '❌ The uploaded file does not appear to be a CV or Resume. Please upload your actual resume.'
    });
  }

  // Role-skills mismatch
  const mismatch = checkRoleSkillsMismatch(role, skills);
  if (mismatch) {
    return res.status(400).json({ error: mismatch });
  }

  const profile = {
    name:           name || 'Candidate',
    email,
    role,
    skills,
    cv_text:        cvText.slice(0, 8000),
    resumeBuffer:   req.file ? req.file.buffer       : null,
    resumeFilename: req.file ? req.file.originalname : null,
  };

  try {
    const result = await processCandidate(profile);
    res.json(result);
  } catch (err) {
    console.error('[career-apply] ERROR:', err.message);
    const status = err.validationError ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ── Local dev ────────────────────────────────────────────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log('Server running on http://localhost:' + PORT);
  });
}

module.exports = app;

// server.js (v2) — Vercel serverless compatible
require('dotenv').config();

const express  = require('express');
const multer   = require('multer');
const mammoth  = require('mammoth');
const cors     = require('cors');

const { processCandidate } = require('./brain.js');

const app = express();

app.use(cors());
// Note: Do NOT add express.json() or express.urlencoded() here
// Multer handles multipart/form-data parsing for the /api/career-apply route

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
      // pdf-parse v1 — simple, Vercel compatible
      const pdfParse = require('pdf-parse');
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

// CV resume keywords — agar inme se koi nahi mila toh CV nahi hai
const CV_KEYWORDS = [
  'experience','education','skills','work','employment','project','summary',
  'objective','profile','qualification','achievement','certification',
  'university','college','degree','bachelor','master','engineer','developer',
  'intern','job','position','company','organization','responsibilities',
  'worked','developed','designed','managed','led','built','created',
  'resume','curriculum','vitae','cv','career','professional'
];

function looksLikeCV(text) {
  if (!text || text.trim().length < 100) return false;
  const lower = text.toLowerCase();
  const matches = CV_KEYWORDS.filter(k => lower.includes(k));
  return matches.length >= 3;
}

// ── Role-Skills mismatch check ───────────────────────────────────────────────
const DESIGN_ROLES    = ['designer','ui','ux','visual','graphic','motion','brand','product design'];
const DESIGN_SKILLS   = ['figma','sketch','xd','adobe xd','illustrator','photoshop','wireframe','prototype','invision','zeplin','framer','canva','indesign'];
const CODING_SKILLS   = ['react','vue','angular','node','python','java','javascript','typescript','django','flask','express','spring','flutter','swift','kotlin','php','ruby','go','rust','c++','c#','html','css','sql','mongodb','postgres','docker','kubernetes','aws','azure','gcp','terraform','jenkins','git','graphql','rest api','next','nuxt','tailwind','bootstrap'];

function checkRoleSkillsMismatch(role, skills) {
  const roleLower   = role.toLowerCase();
  const skillsLower = skills.toLowerCase();

  const isDesignRole   = DESIGN_ROLES.some(k  => roleLower.includes(k));
  const hasDesignSkill = DESIGN_SKILLS.some(k => skillsLower.includes(k));
  const hasCodingSkill = CODING_SKILLS.some(k => skillsLower.includes(k));

  // Designer role but only coding skills, no design tools
  if (isDesignRole && hasCodingSkill && !hasDesignSkill) {
    return `Role mismatch: You selected "${role}" but listed only coding skills (${skills}). ` +
           `A UI/UX Designer should have design tools like Figma, Sketch, Adobe XD, or Prototyping. ` +
           `Did you mean "Frontend Developer" instead?`;
  }

  return null; // no mismatch
}
app.post('/api/career-apply', upload.single('cv'), async (req, res) => {

  // Debug log — visible in Vercel function logs
  console.log('Body keys:', Object.keys(req.body || {}));
  console.log('File:', req.file ? req.file.originalname : 'none');
  console.log('Email:', req.body?.email);

  const cvText = await extractCvText(req.file);

  // ── CV validation ────────────────────────────────────────────────────────
  // File uploaded but text could not be extracted (scanned image PDF etc.)
  if (req.file && !cvText) {
    return res.status(400).json({
      error: '❌ Could not read text from the uploaded file. Please make sure your CV is a text-based PDF or DOCX (not a scanned image).'
    });
  }

  // File uploaded but doesn't look like a CV/Resume
  if (req.file && cvText && !looksLikeCV(cvText)) {
    return res.status(400).json({
      error: '❌ The uploaded file does not appear to be a CV or Resume. Please upload your actual resume containing work experience, skills, and education.'
    });
  }

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

  // ── Role-Skills mismatch check ───────────────────────────────────────────
  const mismatch = checkRoleSkillsMismatch(profile.role, profile.skills);
  if (mismatch) {
    return res.status(400).json({ error: mismatch });
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

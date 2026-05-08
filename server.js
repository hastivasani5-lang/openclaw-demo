const cors    = require('cors');
const express = require('express');
const multer  = require('multer');

require('dotenv').config();

const { processCandidate } = require('./brain');

const app = express();

app.use(cors());
app.use(express.json());                    // JSON body support
app.use(express.urlencoded({ extended: true })); // form body support

// multer — store resume in memory as Buffer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },   // 5 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  }
});

app.post('/api/career-apply', upload.single('resume'), async (req, res) => {

  const profile = {
    name:             req.body.full_name,
    email:            req.body.email,
    role:             req.body.role,
    experience_years: req.body.experience_years,
    skills:           (req.body.skills || '')
                        .split(',')
                        .map(s => s.trim())
                        .filter(Boolean),
    // resume is a Buffer (or undefined if not uploaded)
    resumeBuffer:     req.file ? req.file.buffer       : null,
    resumeFilename:   req.file ? req.file.originalname : null,
  };

  try {
    const result = await processCandidate(profile);
    console.log(result);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }

});

app.listen(4000, () => {
  console.log('Server Running On Port 4000');
});

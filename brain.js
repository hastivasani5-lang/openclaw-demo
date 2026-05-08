// brain.js (v2) — role-aware task generation with Groq AI
require('dotenv').config();

const nodemailer  = require('nodemailer');
const PDFDocument = require('pdfkit');
const https       = require('https');
const OpenAI      = require('openai');

// ---------- Groq AI call (uses OpenAI-compatible SDK) ----------

async function callAI(prompt) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set in environment variables.');

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1',
  });

  const completion = await client.chat.completions.create({
    model:       'llama-3.3-70b-versatile',
    messages:    [{ role: 'user', content: prompt }],
    temperature: 1.0,
    max_tokens:  1200,
    response_format: { type: 'json_object' },
  });

  const text = completion.choices[0].message.content;
  console.log('Groq responded, length:', text.length);
  return text;
}

// ---------- Gmail transport ----------

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD.replace(/\s/g, '')
  }
});

// ---------- Helpers ----------

function getLevel(detectedSeniority) {
  if (!detectedSeniority) return 'JUNIOR';
  const s = detectedSeniority.toLowerCase();
  if (s === 'senior') return 'SENIOR';
  if (s === 'mid')    return 'MID';
  return 'JUNIOR';
}

// ---------- Role-aware, CV-aware prompt ----------

function buildPrompt(profile) {
  const cvBlock = profile.cv_text
    ? '\nCV uploaded:\n"""\n' + profile.cv_text.slice(0, 3000) + '\n"""\n'
    : '\nNo CV uploaded.\n';

  const seed = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  return `You are a hiring manager at Sensussoft. Generate a unique hiring task.
Seed: ${seed}

Candidate:
- Name: ${profile.name}
- Role: ${profile.role}
- Skills: ${profile.skills || 'not provided'}
${cvBlock}

RULES:
1. Validate first — if role or skills are gibberish/random chars, return:
   {"error":"invalid_role","message":"..."} or {"error":"invalid_skills","message":"..."}

2. ROLE-SKILLS MISMATCH CHECK — VERY IMPORTANT:
   - If role is design (UI, UX, Designer, Visual) but skills are ONLY coding technologies
     (React, Vue, Angular, Node.js, Python, Django, etc.) with NO design tools
     (Figma, Sketch, XD, Illustrator, Photoshop, Wireframing, Prototyping),
     return ONLY this JSON:
     {"error":"role_skills_mismatch","message":"Your role is UI/UX Designer but your skills only contain coding technologies (${profile.skills}). A UI/UX Designer should list design tools like Figma, Sketch, Adobe XD, Prototyping, Wireframing. If you are a developer, please update your role to Frontend Developer or Full Stack Developer."}
   - If role is development (Developer, Engineer, Frontend, Backend, Full Stack, Mobile)
     but skills are ONLY design tools (Figma, Sketch, XD, Illustrator) with NO coding skills,
     return ONLY this JSON:
     {"error":"role_skills_mismatch","message":"Your role is ${profile.role} but your skills only contain design tools. A developer should list coding technologies like React, Node.js, Python, etc."}

3. Role category:
   Designer/UI/UX → "design" (Figma task, NO coding)
   QA/Tester/SDET → "qa" (test plan + automation)
   DevOps/SRE/Cloud → "devops" (CI/CD or IaC)
   Product Manager/PM → "product" (PRD or roadmap)
   Developer/Engineer/Mobile/Frontend/Backend → "development" (coding task)

4. Task MUST use candidate's EXACT listed skills in requirements.
   NEVER generate a generic "Todo App" or "Blog App".
   Pick a real business domain: fintech, healthcare, e-commerce, logistics, etc.

5. Seniority from role name or CV:
   Junior → simple 3hr task | Mid → 6hr task | Senior → 8hr complex task

Return ONLY this JSON (no markdown):
{
  "category": "design|qa|devops|product|development",
  "cv_summary": "one sentence about candidate",
  "detected_seniority": "junior|mid|senior",
  "title": "specific title using their actual skills",
  "scenario": "2-3 sentence real business context",
  "requirements": ["req 1 using skill", "req 2", "req 3", "req 4"],
  "deliverables": ["deliverable 1", "deliverable 2"],
  "evaluation_criteria": ["criteria 1", "criteria 2", "criteria 3", "criteria 4"],
  "deadline_days": 3
}`;
}

async function generateTask(profile) {
  const prompt = buildPrompt(profile);
  let text = await callAI(prompt);
  if (!text) throw new Error('AI returned empty response. Please try again.');

  text = text.replace(/```json|```/g, '').trim();

  // Fix truncated JSON — if it ends mid-string, try to close it
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    // Attempt to repair truncated JSON by closing open structures
    console.warn('JSON parse failed, attempting repair. Error:', e.message);
    let repaired = text;
    // Count unclosed brackets/braces
    const opens  = (repaired.match(/\[/g) || []).length;
    const closes = (repaired.match(/\]/g) || []).length;
    const openB  = (repaired.match(/\{/g) || []).length;
    const closeB = (repaired.match(/\}/g) || []).length;
    // Close any open string first
    if ((repaired.match(/"/g) || []).length % 2 !== 0) repaired += '"';
    // Close arrays and objects
    for (let i = 0; i < opens - closes; i++)  repaired += ']';
    for (let i = 0; i < openB - closeB; i++)  repaired += '}';
    try {
      parsed = JSON.parse(repaired);
    } catch (e2) {
      throw new Error('AI returned malformed response. Please try again.');
    }
  }

  // AI returned a validation error
  if (parsed.error === 'invalid_role' || parsed.error === 'invalid_skills' ||
      parsed.error === 'invalid_cv'   || parsed.error === 'role_skills_mismatch') {
    const err = new Error(parsed.message);
    err.validationError = true;
    throw err;
  }

  return parsed;
}

// ---------- Build PDF ----------

function buildPDF(profile, task) {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 0, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W          = doc.page.width;
    const PINK       = '#e91e8c';
    const NAVY       = '#0d1b2a';
    const LIGHT_PINK = '#fce4f3';
    const GRAY       = '#6b7280';
    const level      = getLevel(task.detected_seniority);

    // Navy header
    doc.rect(0, 0, W, 90).fill(NAVY);
    doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold').text('Sensussoft', 40, 22);
    doc.fillColor('#94a3b8').fontSize(9).font('Helvetica').text('AI-Generated Candidate Assessment', 40, 46);

    // Level badge
    const badgeW = 70, badgeH = 22, badgeX = W - 40 - badgeW, badgeY = 28;
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 11).stroke('#ffffff');
    doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
       .text(level, badgeX, badgeY + 6, { width: badgeW, align: 'center' });

    // Pink accent line
    doc.rect(0, 90, W, 4).fill(PINK);

    // Task title & scenario
    let y = 114;
    doc.fillColor(NAVY).fontSize(18).font('Helvetica-Bold').text(task.title, 40, y, { width: W - 80 });
    y = doc.y + 10;
    doc.fillColor('#374151').fontSize(10).font('Helvetica').text(task.scenario, 40, y, { width: W - 80, lineGap: 3 });
    y = doc.y + 18;

    // Candidate info grid
    doc.rect(40, y, W - 80, 68).stroke('#e5e7eb');
    const col1 = 56, col2 = W / 2 + 10;

    doc.fillColor('#9ca3af').fontSize(7).font('Helvetica-Bold').text('NAME', col1, y + 10);
    doc.fillColor(NAVY).fontSize(10).font('Helvetica').text(profile.name, col1, y + 20);
    doc.fillColor('#9ca3af').fontSize(7).font('Helvetica-Bold').text('EMAIL', col2, y + 10);
    doc.fillColor(NAVY).fontSize(10).font('Helvetica').text(profile.email, col2, y + 20);
    doc.fillColor('#9ca3af').fontSize(7).font('Helvetica-Bold').text('ROLE', col1, y + 38);
    doc.fillColor(NAVY).fontSize(10).font('Helvetica').text(profile.role, col1, y + 48);
    doc.fillColor('#9ca3af').fontSize(7).font('Helvetica-Bold').text('CATEGORY', col2, y + 38);
    doc.fillColor(NAVY).fontSize(10).font('Helvetica').text((task.category || '').toUpperCase(), col2, y + 48);
    doc.fillColor('#9ca3af').fontSize(7).font('Helvetica-Bold').text('CV SUMMARY', col1, y + 56);

    y += 68 + 6;
    doc.fillColor(NAVY).fontSize(9).font('Helvetica')
       .text(task.cv_summary || '—', col1, y, { width: W - 80 });
    y = doc.y + 22;

    // Section helper
    function section(title, items, bullet) {
      doc.rect(40, y, 3, 16).fill(PINK);
      doc.fillColor(NAVY).fontSize(13).font('Helvetica-Bold').text(title, 50, y, { width: W - 90 });
      y = doc.y + 8;

      items.forEach((item, i) => {
        if (bullet === 'number') {
          doc.circle(52, y + 5, 8).fill(PINK);
          doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold')
             .text(String(i + 1), 48, y + 2, { width: 8, align: 'center' });
          doc.fillColor('#374151').fontSize(10).font('Helvetica')
             .text(item, 68, y, { width: W - 110, lineGap: 2 });
        } else if (bullet === 'arrow') {
          doc.fillColor(PINK).fontSize(11).font('Helvetica-Bold').text('›', 44, y);
          doc.fillColor('#374151').fontSize(10).font('Helvetica')
             .text(item, 58, y, { width: W - 100, lineGap: 2 });
        } else {
          doc.circle(48, y + 5, 4).fill(PINK);
          doc.fillColor('#374151').fontSize(10).font('Helvetica')
             .text(item, 62, y, { width: W - 104, lineGap: 2 });
        }
        y = doc.y + 6;
      });
      y += 6;
    }

    if (task.requirements       && task.requirements.length)       section('Requirements',        task.requirements,        'number');
    if (task.deliverables       && task.deliverables.length)       section('Deliverables',        task.deliverables,        'arrow');
    if (task.evaluation_criteria && task.evaluation_criteria.length) section('Evaluation Criteria', task.evaluation_criteria, 'dot');

    // Deadline box
    if (task.deadline_days) {
      y += 4;
      doc.rect(40, y, W - 80, 32).fill(LIGHT_PINK);
      doc.fillColor(PINK).fontSize(11).font('Helvetica-Bold')
         .text(`⏰  Deadline: ${task.deadline_days} days from receipt of this email`, 56, y + 10, { width: W - 112 });
      y += 44;
    }

    // Footer
    const footerY = doc.page.height - 44;
    doc.rect(0, footerY - 4, W, 48).fill('#f9fafb');
    doc.rect(0, footerY - 4, W, 2).fill(PINK);
    doc.fillColor(GRAY).fontSize(8).font('Helvetica')
       .text(`© ${new Date().getFullYear()} Sensussoft. All rights reserved.`, 0, footerY + 10, { width: W, align: 'center' });

    doc.end();
  });
}

// ---------- Create GitHub repo ----------

async function createGithubRepo(profile, task) {
  const token = process.env.GITHUB_TOKEN;
  const org   = process.env.GITHUB_ORG;

  if (!token || token === 'your_github_personal_access_token_here') {
    console.warn('⚠️  GITHUB_TOKEN not set — skipping repo creation');
    return null;
  }

  const repoName = `sensussoft-task-${profile.name}-${profile.role}`
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

  const body = JSON.stringify({
    name:        repoName,
    description: `Hiring task for ${profile.name} — ${profile.role} at Sensussoft`,
    private:     false,
    auto_init:   true,
  });

  let path;
  try {
    const orgCheck = await githubRequest('GET', `/orgs/${org}`, token);
    path = orgCheck.login ? `/orgs/${org}/repos` : `/user/repos`;
  } catch (_) { path = `/user/repos`; }

  const repoData = await githubRequest('POST', path, token, body);
  if (!repoData || !repoData.html_url) {
    console.warn('⚠️  GitHub repo creation failed:', JSON.stringify(repoData));
    return null;
  }

  console.log('✅ GitHub repo created:', repoData.html_url);
  await pushTaskReadme(repoData, profile, task, token);
  return repoData.html_url;
}

async function pushTaskReadme(repo, profile, task, token) {
  const readmeContent = `# ${task.title}

> Sensussoft AI-Generated Hiring Task for **${profile.name}** — ${profile.role}

**Category:** ${task.category} | **Level:** ${task.detected_seniority}

> ${task.cv_summary}

## Scenario
${task.scenario}

## Requirements
${(task.requirements || []).map((r, i) => `${i + 1}. ${r}`).join('\n')}

## Deliverables
${(task.deliverables || []).map(d => `- ${d}`).join('\n')}

## Evaluation Criteria
${(task.evaluation_criteria || []).map(c => `- ${c}`).join('\n')}

## Deadline
⏰ ${task.deadline_days} days from receipt of this email

---
*Generated by Sensussoft AI Hiring System*
`;

  const content = Buffer.from(readmeContent).toString('base64');
  let sha;
  try {
    const existing = await githubRequest('GET', `/repos/${repo.full_name}/contents/README.md`, token);
    sha = existing.sha;
  } catch (_) {}

  await githubRequest('PUT', `/repos/${repo.full_name}/contents/README.md`, token,
    JSON.stringify({ message: `Add task: ${task.title}`, content, ...(sha ? { sha } : {}) }));

  console.log('✅ README pushed to repo');
}

function githubRequest(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com', path, method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept':        'application/vnd.github+json',
        'User-Agent':    'sensussoft-hiring-bot',
        'Content-Type':  'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---------- Send email ----------

async function sendEmail(profile, task, pdfBuffer, repoUrl) {
  const PINK = '#e91e8c';
  const categoryBadgeColor = {
    design: '#9C27B0', development: '#1F4E79',
    qa: '#2E7D32', devops: '#E65100', product: '#5D4037'
  }[task.category] || '#1F4E79';

  const list = arr => (arr || []).map(x => `<li style="margin:6px 0">${x}</li>`).join('');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Logo -->
        <tr><td align="center" style="padding-bottom:20px;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="background:${PINK};border-radius:10px;width:36px;height:36px;text-align:center;vertical-align:middle;">
              <span style="color:#fff;font-size:18px;font-weight:bold;">S</span>
            </td>
            <td style="padding-left:10px;font-size:18px;font-weight:bold;color:#111;">Sensussoft</td>
          </tr></table>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <div style="height:4px;background:${PINK};"></div>
          <table width="100%" cellpadding="0" cellspacing="0" style="padding:36px 40px;">

            <tr><td style="padding-bottom:8px;">
              <h1 style="margin:0;font-size:22px;color:#111;">Hi ${profile.name}, your task is attached! 👋</h1>
            </td></tr>

            <tr><td style="padding-bottom:16px;color:#6b7280;font-size:14px;line-height:1.6;">
              Thank you for applying to <strong>Sensussoft</strong> for the
              <strong style="color:${PINK};">${profile.role}</strong> position.
              <br><br>
              <span style="display:inline-block;padding:3px 10px;background:${categoryBadgeColor};color:white;border-radius:4px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">${task.category}</span>
              <span style="display:inline-block;padding:3px 10px;background:#374151;color:white;border-radius:4px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-left:6px;">${task.detected_seniority}</span>
            </td></tr>

            ${task.cv_summary ? `
            <tr><td style="padding-bottom:20px;">
              <div style="background:#f8f9fa;border-left:3px solid ${PINK};padding:12px 16px;border-radius:4px;font-size:13px;color:#555;font-style:italic;">
                "${task.cv_summary}"
              </div>
            </td></tr>` : ''}

            <tr><td style="border-top:1px solid #f0f0f0;padding-bottom:24px;"></td></tr>

            <!-- PDF notice -->
            <tr><td style="padding-bottom:28px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#fce4f3;border-radius:10px;padding:20px 24px;">
                <tr>
                  <td width="36" valign="top" style="padding-right:14px;font-size:22px;">🔗</td>
                  <td>
                    <div style="font-weight:bold;color:#111;font-size:14px;margin-bottom:6px;">Your coding task is in the PDF</div>
                    <div style="color:#6b7280;font-size:13px;line-height:1.6;">
                      We've attached a personalised PDF with your full task details —
                      requirements, deliverables, and evaluation criteria.
                    </div>
                  </td>
                </tr>
              </table>
            </td></tr>

            <!-- Steps -->
            <tr><td style="padding-bottom:16px;">
              <div style="font-size:11px;font-weight:bold;color:#9ca3af;letter-spacing:1px;text-transform:uppercase;margin-bottom:16px;">WHAT TO DO NEXT</div>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;"><tr>
                <td width="28" valign="top"><div style="background:${PINK};color:#fff;border-radius:50%;width:22px;height:22px;text-align:center;line-height:22px;font-size:11px;font-weight:bold;">1</div></td>
                <td style="padding-left:12px;font-size:14px;color:#374151;padding-top:2px;">Open the attached PDF and read your task carefully.</td>
              </tr></table>
              <div style="border-top:1px solid #f0f0f0;margin-bottom:14px;"></div>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;"><tr>
                <td width="28" valign="top"><div style="background:${PINK};color:#fff;border-radius:50%;width:22px;height:22px;text-align:center;line-height:22px;font-size:11px;font-weight:bold;">2</div></td>
                <td style="padding-left:12px;font-size:14px;color:#374151;padding-top:2px;">Complete the task and push your code to the repository.</td>
              </tr></table>
              <div style="border-top:1px solid #f0f0f0;margin-bottom:14px;"></div>

              <table width="100%" cellpadding="0" cellspacing="0"><tr>
                <td width="28" valign="top"><div style="background:${PINK};color:#fff;border-radius:50%;width:22px;height:22px;text-align:center;line-height:22px;font-size:11px;font-weight:bold;">3</div></td>
                <td style="padding-left:12px;font-size:14px;color:#374151;padding-top:2px;">
                  Reply to this email with your submission link within
                  <strong style="color:${PINK};">${task.deadline_days} days.</strong>
                </td>
              </tr></table>
            </td></tr>

            <!-- CTA Button -->
            <tr><td style="padding-top:24px;padding-bottom:28px;">
              <a href="${repoUrl || '#'}" target="_blank"
                 style="display:inline-block;background:${PINK};color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:14px;font-weight:bold;">
                View Starter Repository →
              </a>
            </td></tr>

            <tr><td style="border-top:1px solid #f0f0f0;padding-bottom:20px;"></td></tr>

            <tr><td style="font-size:14px;color:#6b7280;line-height:1.8;">
              Good luck — we're excited to see what you build!<br>
              <strong style="color:#111;">Sensussoft Hiring Team</strong>
            </td></tr>

          </table>
        </td></tr>

        <tr><td align="center" style="padding-top:24px;font-size:12px;color:#9ca3af;">
          © ${new Date().getFullYear()} Sensussoft. All rights reserved.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const attachments = [{
    filename: `Sensussoft_Task_${profile.name.replace(/\s+/g, '_')}.pdf`,
    content:  pdfBuffer,
    contentType: 'application/pdf',
  }];

  if (profile.resumeBuffer) {
    attachments.push({
      filename:    profile.resumeFilename || 'resume.pdf',
      content:     profile.resumeBuffer,
      contentType: 'application/pdf',
    });
  }

  const info = await transporter.sendMail({
    from:    `"Sensussoft Hiring" <${process.env.GMAIL_USER}>`,
    to:      profile.email,
    subject: `Your Hiring Task – ${profile.role} Position`,
    html,
    attachments,
  });

  console.log('✅ Email sent! MessageId:', info.messageId);
}

// ---------- Main entry ----------

async function processCandidate(profile) {
  console.log('\n=== New candidate received ===');
  console.log('Name :', profile.name);
  console.log('Role :', profile.role);
  console.log('CV   :', profile.cv_text ? (profile.cv_text.length + ' chars extracted') : 'none uploaded');

  console.log('🔄 Step 1: Generating task...');
  const task = await generateTask(profile);
  console.log('Category :', task.category);
  console.log('Seniority:', task.detected_seniority);
  console.log('Summary  :', task.cv_summary);
  console.log('Title    :', task.title);

  console.log('🔄 Step 2: Building PDF...');
  const pdfBuffer = await buildPDF(profile, task);
  console.log('✅ PDF built, size:', pdfBuffer.length, 'bytes');

  console.log('🔄 Step 3: Creating GitHub repo...');
  const repoUrl = await createGithubRepo(profile, task);
  console.log('✅ Repo URL:', repoUrl || 'skipped');

  console.log('🔄 Step 4: Sending email to', profile.email);
  await sendEmail(profile, task, pdfBuffer, repoUrl);
  console.log('✅ Email sent successfully!\n');

  return {
    ok:       true,
    accepted: true,
    task_title: task.title,
    category:   task.category,
    seniority:  task.detected_seniority,
    repo_url:   repoUrl,
  };
}

module.exports = { processCandidate };

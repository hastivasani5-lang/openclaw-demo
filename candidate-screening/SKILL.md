---
name: candidate-screening
description: |
  AI Hiring Automation — reads candidate role, skills, and CV,
  generates a personalized task, creates a GitHub repo, builds a PDF,
  and emails the candidate automatically.
version: 1.0.0
metadata:
  openclaw:
    requires:
      env:
        - GROQ_API_KEY
        - GMAIL_USER
        - GMAIL_APP_PASSWORD
        - GITHUB_TOKEN
        - GITHUB_ORG
    primaryEnv: GROQ_API_KEY
    envVars:
      - name: GROQ_API_KEY
        required: true
        description: Groq API key for AI task generation (llama-3.1-8b-instant).
      - name: GMAIL_USER
        required: true
        description: Gmail address used to send task emails.
      - name: GMAIL_APP_PASSWORD
        required: true
        description: Gmail App Password for SMTP authentication.
      - name: GITHUB_TOKEN
        required: true
        description: GitHub Personal Access Token to auto-create candidate repos.
      - name: GITHUB_ORG
        required: true
        description: GitHub username or org where candidate repos are created.
    emoji: "🤖"
    homepage: https://github.com/hastivasani5-lang/openclaw-demo
---

# Candidate Screening Skill

## What it does

When a candidate submits the hiring form (`career.form.submitted` event), this skill:

1. **Analyzes** role, skills, and CV using Groq AI (Llama 3.1 8B)
2. **Validates** role-skills match (e.g. UI/UX Designer should not have only coding skills)
3. **Generates** a personalized hiring task (Junior / Mid / Senior level)
4. **Builds** a professional PDF with task details
5. **Creates** a GitHub repo for the candidate with task README
6. **Emails** the candidate with:
   - Sensussoft-branded HTML email
   - Task PDF as attachment
   - Resume PDF as attachment (if uploaded)
   - "View Starter Repository" button → real GitHub repo link

## Trigger

```
event: career.form.submitted
```

## Input

| Field | Type | Description |
|-------|------|-------------|
| full_name | string | Candidate's full name |
| email | string | Candidate's email address |
| role | string | Role applied for (e.g. Frontend Developer) |
| skills | string | Comma-separated skills (e.g. React, Node.js) |
| resumeBuffer | buffer | Optional CV file buffer |
| resumeFilename | string | Optional CV filename |

## Output

```json
{
  "ok": true,
  "task_title": "React Dashboard with Node.js API Integration",
  "category": "development",
  "seniority": "junior",
  "repo_url": "https://github.com/org/sensussoft-task-name-role"
}
```

## Usage

### Via OpenClaw event
Fire `career.form.submitted` event with candidate data — skill runs automatically.

### Via Express API (direct)
```
POST /api/career-apply
Content-Type: multipart/form-data

full_name=Hasti Vasani
email=candidate@example.com
role=Frontend Developer
skills=React, TypeScript, Node.js
cv=<file>
```

---
name: candidate-screening
description: |
  AI Hiring Automation Skill — generates a role-specific task using AI,
  creates a GitHub repo, builds a PDF, and emails the candidate automatically.
trigger:
  event: career.form.submitted
input:
  full_name: string
  email: string
  role: string
  experience_years: number
  skills: string
---

# Candidate Screening Skill

## What it does
When a candidate submits the hiring form, this skill:

1. **Analyzes** the candidate's role and skills using AI (DeepSeek via OpenRouter)
2. **Generates** a personalized hiring task (Junior / Mid / Senior level)
3. **Builds** a professional PDF with task details (PDFKit)
4. **Creates** a GitHub repo automatically for the candidate
5. **Emails** the candidate with:
   - Sensussoft-branded HTML email
   - Task PDF as attachment
   - Resume PDF as attachment (if uploaded)
   - "View Starter Repository" button linking to their GitHub repo

## Input
| Field | Type | Description |
|-------|------|-------------|
| full_name | string | Candidate's full name |
| email | string | Candidate's email address |
| role | string | Role applied for |
| experience_years | number | Years of experience |
| skills | string | Comma-separated skills |

## Output
```json
{
  "ok": true,
  "task_title": "React Dashboard with Node.js API Integration",
  "repo_url": "https://github.com/org/sensussoft-task-name-role"
}
```

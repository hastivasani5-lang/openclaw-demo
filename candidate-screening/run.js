// OpenClaw Skill: candidate-screening
// Triggered by: career.form.submitted event
// Falls back to direct brain.js call if OpenClaw is not running

const { processCandidate } = require('../brain');

module.exports = async function(input) {

  console.log('================================');
  console.log('OpenClaw Skill: candidate-screening');
  console.log('Event: career.form.submitted');
  console.log('================================');

  // Support both OpenClaw event payload (input.data) and direct call
  const data = input.data || input;

  const profile = {
    name:           data.full_name    || data.name    || 'Candidate',
    email:          data.email,
    role:           data.role         || 'Developer',
    skills:         typeof data.skills === 'string'
                      ? data.skills
                      : Array.isArray(data.skills)
                        ? data.skills.join(', ')
                        : '',
    cv_text:        data.cv_text      || '',
    resumeBuffer:   data.resumeBuffer   || null,
    resumeFilename: data.resumeFilename || null,
  };

  console.log('Profile:', { name: profile.name, role: profile.role, skills: profile.skills });

  // Run full pipeline: AI → PDF → GitHub → Email
  const result = await processCandidate(profile);

  console.log('================================');
  console.log('Skill completed:', result.task_title);
  console.log('================================');

  return result;
};

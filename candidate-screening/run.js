const { processCandidate } = require('../brain');

module.exports = async function(input) {

  console.log("================================");
  console.log("OpenClaw Skill: candidate-screening");
  console.log("Input received:", JSON.stringify(input, null, 2));
  console.log("================================");

  // Input se profile banao
  // OpenClaw event payload: input.data ya directly input
  const data = input.data || input;

  const profile = {
    name:             data.full_name  || data.name,
    email:            data.email,
    role:             data.role,
    experience_years: data.experience_years || data.experience,
    skills:           Array.isArray(data.skills)
                        ? data.skills
                        : (data.skills || '').split(',').map(s => s.trim()).filter(Boolean),
    resumeBuffer:     data.resumeBuffer   || null,
    resumeFilename:   data.resumeFilename || null,
  };

  console.log("Profile built:", profile);

  // brain.js ka full flow chalao:
  // 1. AI se task generate
  // 2. PDF banao
  // 3. GitHub repo create
  // 4. Email bhejo with PDF attachment
  const result = await processCandidate(profile);

  console.log("================================");
  console.log("Skill completed:", result);
  console.log("================================");

  return result;

};

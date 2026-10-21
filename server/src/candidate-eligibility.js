const normalizeName = (value) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const studentName = (student) => [student.first_name, student.given_name, student.last_name]
  .filter(Boolean).join(" ").trim().replace(/\s+/g, " ");

function gradeNumber(value) {
  const match = String(value ?? "").trim().match(/^(?:grade\s*[- ]?\s*|g\s*)?(7|8|9|10|11|12)$/i);
  return match ? Number(match[1]) : null;
}

function representativeGrade(name) {
  if (!/\b(?:representative|rep)\b/i.test(name)) return null;
  const match = name.match(/\b(?:grade\s*[- ]?\s*|g\s*)(7|8|9|10|11|12)\b/i);
  return match ? Number(match[1]) : null;
}

function alreadyCandidate(student, candidates) {
  return candidates.some((candidate) => candidate.student_id != null
    ? candidate.student_id === student.id
    : normalizeName(candidate.full_name) === normalizeName(studentName(student)));
}

module.exports = { normalizeName, studentName, gradeNumber, representativeGrade, alreadyCandidate };

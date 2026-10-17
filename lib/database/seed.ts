import type Database from "better-sqlite3";

const DDL = `
CREATE TABLE departments (
  id       INTEGER PRIMARY KEY NOT NULL,
  name     TEXT NOT NULL,
  building TEXT NOT NULL,
  budget   REAL NOT NULL
);
CREATE TABLE students (
  id              INTEGER PRIMARY KEY NOT NULL,
  name            TEXT NOT NULL,
  email           TEXT,
  age             INTEGER NOT NULL,
  gpa             REAL,
  marks           INTEGER NOT NULL,
  department_id   INTEGER NOT NULL REFERENCES departments(id),
  enrollment_year INTEGER NOT NULL,
  city            TEXT NOT NULL
);
CREATE TABLE courses (
  id            INTEGER PRIMARY KEY NOT NULL,
  title         TEXT NOT NULL,
  credits       INTEGER NOT NULL,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  instructor    TEXT NOT NULL
);
CREATE TABLE enrollments (
  id         INTEGER PRIMARY KEY NOT NULL,
  student_id INTEGER NOT NULL REFERENCES students(id),
  course_id  INTEGER NOT NULL REFERENCES courses(id),
  semester   TEXT NOT NULL,
  grade      TEXT,
  score      INTEGER
);
`;

const DEPARTMENTS: [number, string, string, number][] = [
  [1, "Computer Science", "Turing Hall", 1250000],
  [2, "Mathematics", "Euler Building", 640000],
  [3, "Physics", "Faraday Wing", 910000],
  [4, "Electronics", "Maxwell Centre", 780000],
  [5, "Business", "Drucker House", 520000],
];

const COURSES: [number, string, number, number, string][] = [
  [101, "Compiler Design", 4, 1, "Dr. Rao"],
  [102, "Database Systems", 4, 1, "Dr. Iyer"],
  [103, "Operating Systems", 3, 1, "Dr. Khan"],
  [201, "Linear Algebra", 3, 2, "Dr. Gupta"],
  [202, "Probability", 3, 2, "Dr. Singh"],
  [301, "Quantum Mechanics", 4, 3, "Dr. Mehta"],
  [302, "Optics", 3, 3, "Dr. Nair"],
  [401, "Digital Circuits", 4, 4, "Dr. Das"],
  [402, "Signal Processing", 3, 4, "Dr. Bose"],
  [501, "Operations Management", 3, 5, "Dr. Fernandes"],
];

const FIRST = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Isha", "Vikram", "Ananya", "Arjun", "Sara", "Neel", "Tara", "Dev", "Priya", "Karan"];
const LAST = ["Sharma", "Patel", "Reddy", "Nair", "Joshi", "Menon"];
const CITIES = ["Chennai", "Mumbai", "Delhi", "Pune", "Kolkata", "Bengaluru"];
const SEMESTERS = ["2023-Fall", "2024-Spring", "2024-Fall"];

/** Small deterministic LCG so the seed data is identical on every run. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function gradeFor(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export function buildSeedRows() {
  const rand = makeRandom(20240517);
  const students: [number, string, string | null, number, number | null, number, number, number, string][] = [];
  for (let i = 0; i < 30; i++) {
    const id = i + 1;
    const first = FIRST[i % FIRST.length]!;
    const last = LAST[(i * 7 + Math.floor(i / FIRST.length)) % LAST.length]!;
    const marks = 45 + Math.floor(rand() * 55); // 45..99
    const gpa = Math.round((1.8 + (marks - 45) * 0.0365 + rand() * 0.2) * 100) / 100;
    students.push([
      id,
      `${first} ${last}`,
      id % 9 === 0 ? null : `${first.toLowerCase()}.${last.toLowerCase()}${id}@campus.example`,
      18 + Math.floor(rand() * 7),
      id === 14 ? null : Math.min(4, gpa),
      marks,
      (i % 5) + 1,
      2021 + (i % 4),
      CITIES[Math.floor(rand() * CITIES.length)]!,
    ]);
  }

  const enrollments: [number, number, number, string, string | null, number | null][] = [];
  let enrollmentId = 1;
  for (const s of students) {
    const studentId = s[0];
    const picks = new Set<number>();
    const count = 2 + Math.floor(rand() * 2); // 2..3 courses each
    while (picks.size < count) picks.add(COURSES[Math.floor(rand() * COURSES.length)]![0]);
    for (const courseId of picks) {
      const semester = SEMESTERS[Math.floor(rand() * SEMESTERS.length)]!;
      const pending = semester === "2024-Fall" && rand() < 0.4; // grade not yet awarded
      const score = Math.max(35, Math.min(100, s[5] + Math.floor(rand() * 21) - 10));
      enrollments.push([enrollmentId++, studentId, courseId, semester, pending ? null : gradeFor(score), pending ? null : score]);
    }
  }
  return { students, enrollments };
}

/** Creates the schema and loads the sample data. Safe to call on an empty database only. */
export function seedDatabase(db: Database.Database): void {
  const { students, enrollments } = buildSeedRows();
  db.pragma("foreign_keys = ON");
  const tx = db.transaction(() => {
    db.exec(DDL);
    const insertDept = db.prepare("INSERT INTO departments (id, name, building, budget) VALUES (?, ?, ?, ?)");
    const insertCourse = db.prepare("INSERT INTO courses (id, title, credits, department_id, instructor) VALUES (?, ?, ?, ?, ?)");
    const insertStudent = db.prepare(
      "INSERT INTO students (id, name, email, age, gpa, marks, department_id, enrollment_year, city) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertEnrollment = db.prepare("INSERT INTO enrollments (id, student_id, course_id, semester, grade, score) VALUES (?, ?, ?, ?, ?, ?)");
    for (const r of DEPARTMENTS) insertDept.run(...r);
    for (const r of COURSES) insertCourse.run(...r);
    for (const r of students) insertStudent.run(...r);
    for (const r of enrollments) insertEnrollment.run(...r);
  });
  tx();
}

/** Drops every table and re-seeds. Used by the reset script; never exposed over HTTP. */
export function resetDatabase(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  for (const { name } of names) db.exec(`DROP TABLE IF EXISTS "${name.replace(/"/g, '""')}"`);
  seedDatabase(db);
}

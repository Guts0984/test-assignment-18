import { type Tx } from '../src/client';
import { SCHOOL_COUNT, type SeedSizes } from './sizes';

export const seedPeople = async (
  tx: Tx,
  sizes: SeedSizes,
  passwordHash: string,
  now: Date,
): Promise<void> => {
  await tx.$executeRawUnsafe(
    `INSERT INTO schools (id, name)
     SELECT md5('school-' || s)::uuid,
            (ARRAY['Northwind Academy', 'Dnipro Code School', 'Vistula Digital', 'Hudson Learning'])[s]
       FROM generate_series(1, $1::int) s`,
    SCHOOL_COUNT,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO users (id, email, password_hash, full_name, role, school_id, created_at)
     SELECT md5(r.role || '-' || s || '-1')::uuid, r.role || '@school' || s || '.example.test',
            $2, initcap(r.role) || ' of school ' || s, r.role, md5('school-' || s)::uuid, $3
       FROM generate_series(1, $1::int) s, (VALUES ('admin'), ('manager')) r(role)`,
    SCHOOL_COUNT,
    passwordHash,
    now,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO users (id, email, password_hash, full_name, role, school_id, created_at)
     SELECT md5('mentor-' || s || '-' || m)::uuid,
            'mentor' || m || '@school' || s || '.example.test', $3,
            'Mentor ' || m || ' of school ' || s, 'mentor', md5('school-' || s)::uuid, $4
       FROM generate_series(1, $1::int) s, generate_series(1, $2::int) m`,
    SCHOOL_COUNT,
    sizes.mentorsPerSchool,
    passwordHash,
    now,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO users (id, email, password_hash, full_name, role, time_zone, created_at)
     SELECT md5('student-' || n)::uuid, 'student' || n || '@students.example.test', $2,
            (ARRAY['Olena','Taras','Iryna','Andrii','Zofia','Jakub','Emma','Noah','Sofiia',
                   'Maksym','Anna','Piotr','Olivia','Liam','Daryna','Bohdan'])[1 + n % 16]
            || ' ' ||
            (ARRAY['Shevchenko','Kovalenko','Bondar','Melnyk','Nowak','Kowalski','Smith',
                   'Johnson','Tkachenko','Wozniak','Brown','Garcia','Lysenko','Moroz',
                   'Savchenko','Wilson','Marchenko'])[1 + n % 17]
            || ' ' || n,
            'student',
            (ARRAY['Europe/Kyiv','Europe/Warsaw','America/New_York'])[1 + n % 3], $3
       FROM generate_series(1, $1::int) n`,
    sizes.students,
    passwordHash,
    now,
  );
};

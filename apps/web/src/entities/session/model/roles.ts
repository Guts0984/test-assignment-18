export type SessionRole = 'student' | 'mentor' | 'manager' | 'admin';

export const homeOf = (role: SessionRole): string =>
  ({ student: '/account', mentor: '/mentor', manager: '/manager', admin: '/admin' })[role];

export const NAVIGATION: Readonly<Record<SessionRole, readonly (readonly [string, string])[]>> = {
  student: [
    ['/', 'Catalog'],
    ['/account', 'My studies'],
    ['/account/enrollments', 'Enrollments'],
    ['/account/certificates', 'Certificates'],
  ],
  mentor: [
    ['/mentor', 'Review queue'],
    ['/mentor/students', 'My students'],
  ],
  manager: [
    ['/manager', 'Cohorts'],
    ['/manager/courses', 'Courses'],
    ['/manager/students', 'Students'],
    ['/manager/promos', 'Promo codes'],
    ['/manager/report', 'Report'],
    ['/manager/jobs', 'Failed jobs'],
  ],
  admin: [
    ['/admin', 'Staff'],
    ['/admin/gateway', 'Payment system'],
  ],
};

const NOWHERE = 'http://site.invalid';

/**
 * Anything up to and including the space, or a backslash: browsers drop tabs and line breaks
 * from addresses and read a backslash as a slash.
 */
const TRICKY = /[^!-￿]|\\/;

/** Where to go after signing in: only a path on this site is accepted from the address. */
export const safeNext = (next: string | null, fallback: string): string => {
  if (!next?.startsWith('/') || TRICKY.test(next)) return fallback;
  // Some inputs, such as a bare `//`, are not addresses at all.
  if (!URL.canParse(next, NOWHERE)) return fallback;
  const target = new URL(next, NOWHERE);
  // `//host` and `/.//host` resolve to another site or to a path that would later.
  if (target.origin !== NOWHERE || target.pathname.startsWith('//')) return fallback;
  return `${target.pathname}${target.search}${target.hash}`;
};

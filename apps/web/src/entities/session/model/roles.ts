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

/** Where to go after signing in: only a path on this site is accepted from the address. */
export const safeNext = (next: string | null, fallback: string): string =>
  next && /^\/(?![/\\])/.test(next) ? next : fallback;

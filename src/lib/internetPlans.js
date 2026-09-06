export const INTERNET_PLAN_DELAYS = Object.freeze({ 'Básico': 5000, Ultra: 3000, Mega: 0 });
export const getInternetDelay = (plan) => INTERNET_PLAN_DELAYS[plan] ?? INTERNET_PLAN_DELAYS['Básico'];
export const remainingInternetDelay = (plan, elapsed) => Math.max(0, getInternetDelay(plan) - Math.max(0, elapsed));

export function isInternetDelayExempt(pathname, user) {
  if (!user?.id || user.onboarding_completed === false) return true;
  return [
    '/registro-cidadania', '/login', '/register', '/auth/callback', '/update-password',
    '/forgot-password', '/community', '/help', '/about', '/donate', '/country-info',
    '/contact', '/support', '/faq', '/docs', '/account-deletion', '/admin-dashboard',
  ].some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

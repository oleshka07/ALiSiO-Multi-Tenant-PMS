import { permanentRedirect } from 'next/navigation';

/**
 * The login page moved to /app/login when the operator app moved under /app.
 * Bookmarks, saved passwords and anything that linked here for the last year
 * still work — and a 308 tells browsers to stop asking.
 */
export default function LegacyLoginPage() {
  permanentRedirect('/app/login');
}

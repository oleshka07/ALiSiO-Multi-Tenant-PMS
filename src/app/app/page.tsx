import { redirect } from 'next/navigation';

/** /app is the door to the product; the dashboard is what is behind it. */
export default function AppEntryPage() {
  redirect('/app/dashboard');
}

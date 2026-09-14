/**
 * Focused shell — checkout and authentication.
 *
 * No navigation, no footer, no mini cart. Once someone has decided to buy or to
 * sign in, every other link on the page is an exit. These routes carry their
 * own minimal header (logo + a security cue) so the brand is still present
 * without offering a way out.
 */
export default function FocusedLayout({ children }: { children: React.ReactNode }) {
  return <div className="bg-paper min-h-screen">{children}</div>;
}

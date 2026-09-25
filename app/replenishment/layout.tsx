/**
 * Route-scoped: adds the Inter font only for /replenishment, matching the reference
 * product's typography. Next.js hoists <link> tags from a nested layout into <head> and
 * removes them again when navigating away, so /investigate (root app/layout.tsx +
 * globals.css's own Manrope/DM Mono @import) is completely unaffected.
 */
export default function ReplenishmentLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      {children}
    </>
  );
}

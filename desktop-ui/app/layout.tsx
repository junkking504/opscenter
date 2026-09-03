import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OpsCenter Desktop Command Concept',
  description: 'A desktop-first operational hub concept for Junk King Louisiana.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

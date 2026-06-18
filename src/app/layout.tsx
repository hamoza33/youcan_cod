import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'COD → YouCan → GMC Automation',
  description: 'KSA COD Network product import, SEO, YouCan, and Google Merchant Center automation dashboard.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

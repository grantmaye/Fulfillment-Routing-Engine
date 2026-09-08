import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Dispatch | Fulfillment Routing Engine',
  description:
    'Compare warehouse inventory and shipping costs. Route every order with a clear decision trail.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

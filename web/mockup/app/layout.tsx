import { Outfit, Cormorant_Garamond } from 'next/font/google';
import './style.css';
const outfit = Outfit({ subsets: ['latin'], variable: '--sans' });
const serif = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--serif',
});
export const metadata = { title: 'Dashboard mockup · Recipe Genie' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${outfit.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}

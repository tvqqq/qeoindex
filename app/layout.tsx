import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Plus_Jakarta_Sans } from 'next/font/google'
import { AppAuthGate } from '@/components/auth/app-auth-gate'
import { getServerAuthContext } from '@/lib/auth/server'
import { BRAND } from '@/lib/brand'
import './globals.css'

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700', '800'],
  style: ['normal', 'italic'],
  variable: '--font-plus-jakarta-sans',
})

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.url),
  title: `${BRAND.name} — ${BRAND.slogan}`,
  description: BRAND.description,
  applicationName: BRAND.name,
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    url: '/',
    title: `${BRAND.name} — ${BRAND.slogan}`,
    description: BRAND.description,
    siteName: BRAND.name,
  },
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#07090b',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const serverSessionAuthenticated = Boolean(await getServerAuthContext())

  return (
    <html lang="vi" className={`${geistSans.variable} ${geistMono.variable} ${plusJakartaSans.variable} bg-background`}>
      <body className="font-sans antialiased">
        <AppAuthGate serverSessionPresent={serverSessionAuthenticated}>{children}</AppAuthGate>
        {process.env.NODE_ENV === 'production' && <Analytics />}
        {process.env.NODE_ENV === 'production' && <SpeedInsights />}
      </body>
    </html>
  )
}

import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Water Sort Developer Playtest',
  description: 'Blind developer playtest for Water Sort difficulty research',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  )
}

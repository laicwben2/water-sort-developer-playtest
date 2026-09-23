import { PlaytestShell } from '../components/PlaytestShell'

export default function Page() {
  const clientVersion = process.env.VERCEL_GIT_COMMIT_SHA ?? 'local-dev'

  return (
    <main>
      <PlaytestShell clientVersion={clientVersion} />
    </main>
  )
}

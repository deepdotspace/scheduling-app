/**
 * App — DeepSpace auth + RecordRoom + BookMe shell (generouted wrapper).
 */

import { BookMeAppShell } from '../book-me-app-shell'
import { DeepSpaceAuthProvider, useAuth, PlatformProvider, GuestBanner } from 'deepspace'
import { RecordProvider, RecordScope } from 'deepspace'
import { APP_NAME, SCOPE_ID } from '../constants'
import { recordScopeSchemas } from '../schemas'

export default function App() {
  return (
    <DeepSpaceAuthProvider>
      <AuthGate>
        <PlatformProvider>
          <GuestBanner
            message="You're signed out. Sign in with Google to use BookWithMe with your DeepSpace account."
            onSignIn={() => {
              window.location.href = '/api/auth/social-redirect?provider=google'
            }}
          />
          <BookMeAppShell />
        </PlatformProvider>
      </AuthGate>
    </DeepSpaceAuthProvider>
  )
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoaded } = useAuth()

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background text-muted-foreground">
        Loading...
      </div>
    )
  }

  return (
    <RecordProvider allowAnonymous>
      <RecordScope roomId={SCOPE_ID} schemas={recordScopeSchemas} appId={APP_NAME}>
        {children}
      </RecordScope>
    </RecordProvider>
  )
}

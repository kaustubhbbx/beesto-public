// src/components/layout/ClerkApiInit.jsx
// Injects Clerk's getToken into the api.js service once, on mount.
// Placed inside <SignedIn> so Clerk is always ready when this runs.

import { useEffect } from 'react';
import { useAuth as useClerkAuth } from '@clerk/clerk-react';
import { initApiAuth } from '../../services/api';

export default function ClerkApiInit() {
  const { getToken } = useClerkAuth();

  useEffect(() => {
    // Give api.js a function it can call any time it needs a fresh Bearer token
    initApiAuth(() => getToken());
  }, [getToken]);

  return null;
}

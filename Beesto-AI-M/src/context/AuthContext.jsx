// FILE: src/context/AuthContext.jsx
import React, { createContext, useContext, useCallback, useEffect } from 'react';
import { useUser, useClerk, useAuth as useClerkAuth } from '@clerk/clerk-react';
import { dark } from '@clerk/themes';
import { avatars } from '../assets/avatar-assets/avatar-assests';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { user: clerkUser, isLoaded } = useUser();
  const { signOut, openUserProfile: clerkOpenUserProfile } = useClerk();
  
  // 🎯 Grab both getToken and the live reactive session state from Clerk
  const { getToken, session } = useClerkAuth();

  const user = clerkUser
    ? {
        id:          clerkUser.id,
        name:        clerkUser.fullName || clerkUser.username || clerkUser.emailAddresses[0]?.emailAddress || 'User',
        email:       clerkUser.emailAddresses[0]?.emailAddress || '',
        username:    clerkUser.username || '',
        avatarIndex: Number(clerkUser.unsafeMetadata?.avatarIndex ?? 0),
        imageUrl:    clerkUser.imageUrl,
      }
    : null;

  useEffect(() => {
    // 🛑 THE MASTER GATE: Ensure Clerk is fully loaded, the user exists,
    // AND the active session container has initialized. If any are missing, exit instantly.
    if (!isLoaded || !clerkUser || !clerkUser.id || !session) return;

    (async () => {
      try {
        const token = await getToken();
        if (!token || token === 'null' || token === 'undefined') return; 

        const currentMetadataIndex = clerkUser.unsafeMetadata?.avatarIndex;
        if (currentMetadataIndex === undefined) {
          try {
            const response = await fetch(avatars[0]);
            const fileBlob = await response.blob();
            const imageFile = new File([fileBlob], 'default-avatar.png', { type: 'image/png' });
            await clerkUser.setProfileImage({ file: imageFile });
            await clerkUser.update({
              unsafeMetadata: { ...clerkUser.unsafeMetadata, avatarIndex: 0 }
            });
          } catch (imgErr) {
            console.error("Auto-upload of default avatar failed:", imgErr);
          }
        }

        // Sync endpoint defaults to Render production backend, fallback can be overridden by VITE_API_URL env variable
        const BASE  = import.meta.env.VITE_API_URL || 'https://beesto-ai-mern.onrender.com';
        const response = await fetch(`${BASE}/api/user/sync`, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            name:     clerkUser.fullName || '',
            email:    clerkUser.emailAddresses[0]?.emailAddress || '',
            username: clerkUser.username || '',
          }),
        });

        // Short-circuit quietly if caught in an early rendering frame
        if (response.status === 401) {
          return;
        }

        // Only signal that Clerk auth is ready after a verified, successful sync response
        window.dispatchEvent(new Event('clerk-auth-ready'));

      } catch (err) {
        console.warn('User sync failed (non-fatal):', err.message);
      }
    })();
  }, [clerkUser?.id, getToken, isLoaded, session]);

  const logout = useCallback(() => {
    signOut();
    localStorage.removeItem('beesto_chats_v2');
  }, [signOut]);

  const updateProfile = useCallback(async ({ name, username, avatarIndex, clearProfile, profileImage }) => {
    if (!clerkUser) return;
    
    const updates = {};
    if (name !== undefined) {
      updates.firstName = name;
      updates.lastName = '';
    }
    if (username !== undefined) updates.username  = username || undefined;
    
    try {
      if (profileImage) {
        await clerkUser.setProfileImage({ file: profileImage });
        updates.unsafeMetadata = { ...clerkUser.unsafeMetadata, avatarIndex: null };
      } else {
        const targetIdx = clearProfile ? 0 : (avatarIndex !== undefined ? avatarIndex : (clerkUser.unsafeMetadata?.avatarIndex ?? 0));
        const imgPath = avatars[targetIdx] || avatars[0];
        
        const response = await fetch(imgPath);
        const fileBlob = await response.blob();
        const imageFile = new File([fileBlob], `avatar-${targetIdx}.png`, { type: 'image/png' });
        
        await clerkUser.setProfileImage({ file: imageFile });
        updates.unsafeMetadata = { ...clerkUser.unsafeMetadata, avatarIndex: targetIdx };
      }
    } catch (imgErr) {
      console.error("Failed to upload avatar to Clerk:", imgErr);
    }
    
    await clerkUser.update(updates);
  }, [clerkUser]);

  const openUserProfile = useCallback((isDarkActive) => {
    clerkOpenUserProfile({
      appearance: {
        baseTheme: isDarkActive ? dark : undefined,
        variables: {
          colorPrimary: '#f59e0b',
          colorBackground:      isDarkActive ? '#09090b' : '#ffffff',
          colorText:            isDarkActive ? '#f4f4f5' : '#000000',
          colorTextSecondary:   isDarkActive ? '#a1a1aa' : '#71717a',
          colorInputBackground: isDarkActive ? '#18181b' : '#f4f4f5',
          colorInputText:       isDarkActive ? '#ffffff' : '#000000',
          colorBorder:          isDarkActive ? '#27272a' : '#e4e4e7',
        },
        elements: {
          card: {
            backgroundColor: isDarkActive ? '#09090b !important' : '#ffffff !important',
            border:          isDarkActive ? '1px solid #27272a !important' : '1px solid #e4e4e7 !important',
          },
          navbar: {
            backgroundColor: isDarkActive ? '#18181b !important' : '#f4f4f5 !important',
            borderRight:     isDarkActive ? '1px solid #27272a !important' : '1px solid #e4e4e7 !important',
          },
          navbarButton: {
            color: isDarkActive ? '#a1a1aa !important' : '#71717a !important',
            '&:hover': {
              backgroundColor: isDarkActive ? '#27272a !important' : '#f4f4f5 !important',
            }
          },
          headerTitle: { color: isDarkActive ? '#ffffff !important' : '#000000 !important' },
          headerSubtitle: { color: isDarkActive ? '#a1a1aa !important' : '#71717a !important' },
          profileSectionTitleText: { color: isDarkActive ? '#f4f4f5 !important' : '#000000 !important' }
        }
      }
    });
  }, [clerkOpenUserProfile]);

  const authReady = isLoaded;

  return (
    <AuthContext.Provider value={{ user, authReady, logout, updateProfile, openUserProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
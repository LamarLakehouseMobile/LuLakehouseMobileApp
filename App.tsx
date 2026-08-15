import { NavigationContainer } from '@react-navigation/native';
import { AuthProvider } from './hooks/useAuth';
import { MLProvider } from './context/MLContext';
import RootNavigator from './navigation/RootNavigator';
import React, { useEffect } from 'react';
import { Linking } from 'react-native';
import { Buffer } from 'buffer';
import { supabase } from './lib/supabase';
(globalThis as any).Buffer = Buffer;

async function handleAuthDeepLink(url: string | null) {
  if (!url) return;

  try {
    const parsed = new URL(url);
    const params = new URLSearchParams(parsed.search);
    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));

    const code = params.get('code') ?? hashParams.get('code');
    const accessToken = params.get('access_token') ?? hashParams.get('access_token');
    const refreshToken = params.get('refresh_token') ?? hashParams.get('refresh_token');
    const tokenHash = params.get('token_hash') ?? hashParams.get('token_hash');
    const type = params.get('type') ?? hashParams.get('type');
    const email = params.get('email') ?? hashParams.get('email');

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.warn('Supabase auth code exchange failed:', error.message);
      }
      return;
    }

    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) {
        console.warn('Supabase session set failed:', error.message);
      }
      return;
    }

    if (tokenHash && type) {
      const { error } = await supabase.auth.verifyOtp({
        type: type as any,
        token: tokenHash,
        email: email ?? undefined,
      });
      if (error) {
        console.warn('Supabase token verification failed:', error.message);
      }
    }
  } catch (error) {
    console.warn('Unable to parse auth deep link:', error);
  }
}

export default function App() {
  useEffect(() => {
    let isMounted = true;

    const handleIncomingLink = (event: { url: string }) => {
      if (!isMounted) return;
      handleAuthDeepLink(event.url);
    };

    Linking.getInitialURL().then((url) => {
      if (!isMounted) return;
      handleAuthDeepLink(url);
    });

    const subscription = Linking.addEventListener('url', handleIncomingLink);

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  return (
    <AuthProvider>
      <MLProvider>
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
      </MLProvider>
    </AuthProvider>
  );
}
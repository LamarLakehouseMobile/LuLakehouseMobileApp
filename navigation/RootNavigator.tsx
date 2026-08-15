import React from 'react';
import { useAuth } from '../hooks/useAuth';
import AuthNavigator from './AuthNavigator';
import HomeNavigator from './HomeNavigator';

export default function RootNavigator() {
  const { user } = useAuth();

  if (!user) {
    return <AuthNavigator />;
  }

  return <HomeNavigator />;
}
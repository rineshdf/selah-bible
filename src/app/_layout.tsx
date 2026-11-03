import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { initDatabase } from '@/db/database';
import { ThemeProvider } from '@/constants/ThemeContext';

export default function RootLayout() {
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    // Create the user_journal.db tables before any screen touches them.
    try {
      initDatabase();
    } catch (error) {
      console.error('Failed to initialize user_journal.db:', error);
    } finally {
      setDbReady(true);
    }
  }, []);

  return (
    <ThemeProvider>
      {/* DB init keeps running before the stack renders; screens tolerate it. */}
      {dbReady ? (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
        </Stack>
      ) : null}
    </ThemeProvider>
  );
}

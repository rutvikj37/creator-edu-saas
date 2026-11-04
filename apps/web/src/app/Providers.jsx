import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { Toaster } from 'sonner';
import i18n from '../i18n/index.js';
import { ThemeProvider, useTheme } from '../context/ThemeContext.jsx';
import { createQueryClient } from './queryClient.js';
import { AuthProvider } from '../context/AuthContext.jsx';

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} position="top-right" richColors closeButton />;
}

export function Providers({ children }) {
  const [client] = useState(createQueryClient);
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
          <ThemedToaster />
        </ThemeProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

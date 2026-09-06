import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import App from '@/App';
import '@/index.css';
import 'react-phone-number-input/style.css';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { Toaster } from '@/components/ui/toaster';
import { Capacitor } from '@capacitor/core';
import ConsentAwareAnalytics from '@/components/ConsentAwareAnalytics';
import PwaUpdateNotice from '@/components/PwaUpdateNotice';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HelmetProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ThemeProvider>
            <Toaster />
            <App />
            <ConsentAwareAnalytics />
            {import.meta.env.PROD && !Capacitor.isNativePlatform() && <PwaUpdateNotice />}
        </ThemeProvider>
      </BrowserRouter>
    </HelmetProvider>
  </React.StrictMode>
);

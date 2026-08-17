import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import App from '@/App';
import '@/index.css';
import 'react-phone-number-input/style.css';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { CartProvider } from '@/contexts/CartContext';
import { Toaster } from '@/components/ui/toaster';
import { Capacitor } from '@capacitor/core';
import ConsentAwareAnalytics from '@/components/ConsentAwareAnalytics';
// Módulo virtual fornecido pelo vite-plugin-pwa durante dev/build.
// eslint-disable-next-line import/no-unresolved
import { registerSW } from 'virtual:pwa-register';

if (import.meta.env.PROD && !Capacitor.isNativePlatform()) {
  registerSW({ immediate: true });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HelmetProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ThemeProvider>
            <Toaster />
            <CartProvider>
                <App />
                <ConsentAwareAnalytics />
            </CartProvider>
        </ThemeProvider>
      </BrowserRouter>
    </HelmetProvider>
  </React.StrictMode>
);

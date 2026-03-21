import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { Analytics } from '@vercel/analytics/react';
import App from '@/App';
import '@/index.css';
import 'react-phone-number-input/style.css';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { CartProvider } from '@/contexts/CartContext';
import { Toaster } from '@/components/ui/toaster';

if (import.meta.env.PROD && typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  // Removido React.StrictMode para evitar renderizações duplas em desenvolvimento que causam toasts duplicados.
  <HelmetProvider>
    <BrowserRouter>
      <ThemeProvider>
          <Toaster />
          <CartProvider>
              <App />
              <Analytics />
          </CartProvider>
      </ThemeProvider>
    </BrowserRouter>
  </HelmetProvider>
);

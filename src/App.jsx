import React from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/contexts/AuthContext';
import Navbar from '@/components/Navbar';
import ScrollToTop from '@/components/ScrollToTop';
import Home from '@/pages/Home';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import About from '@/pages/About';
import Contact from '@/pages/Contact';
import Terms from '@/pages/Terms';
import Privacy from '@/pages/Privacy';
import Roadmap from '@/pages/Roadmap';
import Bank from '@/pages/services/Bank';
import Business from '@/pages/services/Business';
import DIC from '@/pages/services/DIC';
import SocialX from '@/pages/services/SocialX';
import Library from '@/pages/services/Library';
import DigitalArchive from '@/pages/services/DigitalArchive';
import Footer from '@/components/Footer';
import FAQ from '@/pages/FAQ';
import ForgotPassword from '@/pages/ForgotPassword';
import UpdatePassword from '@/pages/UpdatePassword';
import ScrollRestoration from '@/components/ScrollRestoration';
import Community from '@/pages/Community';
import News from '@/pages/News';
import Documentation from '@/pages/Documentation';
import ErrorPage from '@/pages/ErrorPage';
import SupportUs from '@/pages/SupportUs';
import UnderConstruction from '@/pages/UnderConstruction';
import { AnimatePresence } from 'framer-motion';
import Dashboard from '@/pages/Dashboard';
import Settings from '@/pages/Settings';
import ProtectedRoute from '@/components/ProtectedRoute';
import ServiceProtectedRoute from '@/components/ServiceProtectedRoute';
import XProfile from '@/pages/services/XProfile';
import AdminDashboard from '@/pages/admin/AdminDashboard';
import AdminProtectedRoute from '@/components/admin/AdminProtectedRoute';

function App() {
  const location = useLocation();
  return (
    <AuthProvider>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 custom-scrollbar">
        <Navbar />
        <main className="pt-20">
          <ScrollRestoration />
          <AnimatePresence mode="wait">
            <Routes location={location} key={location.pathname}>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/update-password" element={<UpdatePassword />} />
              <Route path="/about" element={<About />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/roadmap" element={<Roadmap />} />
              <Route path="/faq" element={<FAQ />} />
              <Route path="/support-us" element={<SupportUs />} />
              <Route path="/community" element={<Community />} />
              <Route path="/news" element={<News />} />
              <Route path="/docs" element={<Documentation />} />
              <Route path="/under-construction" element={<UnderConstruction />} />
              
              <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
              
              <Route path="/services/bank" element={<ServiceProtectedRoute service="bank"><Bank /></ServiceProtectedRoute>} />
              <Route path="/services/business" element={<ServiceProtectedRoute service="business"><Business /></ServiceProtectedRoute>} />
              <Route path="/services/dic" element={<ServiceProtectedRoute service="dic"><DIC /></ServiceProtectedRoute>} />
              <Route path="/services/x" element={<ServiceProtectedRoute service="x"><SocialX /></ServiceProtectedRoute>} />
              <Route path="/services/x/profile/:handle" element={<ServiceProtectedRoute service="x"><XProfile /></ServiceProtectedRoute>} />
              <Route path="/services/library" element={<ProtectedRoute><Library /></ProtectedRoute>} />
              <Route path="/services/digital-archive" element={<ProtectedRoute><DigitalArchive /></ProtectedRoute>} />

              <Route path="/admin" element={<AdminProtectedRoute><AdminDashboard /></AdminProtectedRoute>} />
              <Route path="/admin/:tab" element={<AdminProtectedRoute><AdminDashboard /></AdminProtectedRoute>} />

              <Route path="*" element={<ErrorPage />} />
            </Routes>
          </AnimatePresence>
        </main>
        <Footer />
        <ScrollToTop />
        <Toaster />
      </div>
    </AuthProvider>
  );
}

export default App;
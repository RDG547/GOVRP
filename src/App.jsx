import React from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/contexts/AuthContext';
import Navbar from '@/components/Navbar';
import Home from '@/pages/Home';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import About from '@/pages/About';
import Contact from '@/pages/Contact';
import Support from '@/pages/Support';
import Terms from '@/pages/Terms';
import Privacy from '@/pages/Privacy';
import Roadmap from '@/pages/Roadmap';
import Services from '@/pages/Services';
import Bank from '@/pages/services/Bank';
import Business from '@/pages/services/Business';
import DIC from '@/pages/services/DIC';
import Library from '@/pages/services/Library';
import DigitalArchive from '@/pages/services/DigitalArchive';
import Footer from '@/components/Footer';
import FAQ from '@/pages/FAQ';
import ForgotPassword from '@/pages/ForgotPassword';
import UpdatePassword from '@/pages/UpdatePassword';
import ScrollRestoration from '@/components/ScrollRestoration';
import Community from '@/pages/Community';
import News from '@/pages/News';
import Article from '@/pages/Article';
import Documentation from '@/pages/Documentation';
import ErrorPage from '@/pages/ErrorPage';
import Donation from '@/pages/Donation';
import SupportUs from '@/pages/SupportUs';
import UnderConstruction from '@/pages/UnderConstruction';
import { AnimatePresence } from 'framer-motion';
import Dashboard from '@/pages/Dashboard';
import Settings from '@/pages/Settings';
import ProtectedRoute from '@/components/ProtectedRoute';
import ServiceProtectedRoute from '@/components/ServiceProtectedRoute';
import AdminDashboard from '@/pages/admin/AdminDashboard';
import AdminProtectedRoute from '@/components/admin/AdminProtectedRoute';
import WelcomeTutorial from '@/components/WelcomeTutorial';
import CookieConsent from '@/components/CookieConsent';
import TutorialPage from '@/pages/TutorialPage';

import SocialX from '@/pages/services/SocialX';
import XFeed from '@/components/social-x/XFeed';
import XProfile from '@/pages/services/XProfile';
import XNotifications from '@/pages/services/x/Notifications';
import XMessages from '@/pages/services/x/Messages';
import XSearch from '@/pages/services/x/Search';

// Governance Imports
import Elections from '@/pages/services/Elections';
import PoliticalParties from '@/pages/services/PoliticalParties';
import PenalSystem from '@/pages/services/PenalSystem';
import Parliament from '@/pages/services/Parliament';
import { useTheme } from '@/contexts/ThemeContext';

// Service Imports
import RoleDashboard from '@/pages/dashboards/RoleDashboard';
import Police from '@/pages/services/Police';
import AGIES from '@/pages/services/AGIES';
import ArmedForces from '@/pages/services/ArmedForces';
import PolicePanel from '@/pages/services/PolicePanel';
import ArmedForcesPanel from '@/pages/services/ArmedForcesPanel';
import AGIESPanel from '@/pages/services/AGIESPanel';
import ServiceAccess from '@/components/ServiceAccess';
import RoleProtectedRoute from '@/components/RoleProtectedRoute';
import ParliamentPanel from '@/pages/services/ParliamentPanel';
import PenalSystemPanel from '@/pages/services/PenalSystemPanel';


function App() {
  const location = useLocation();
  const { theme } = useTheme();

  return (
    <AuthProvider>
      <div className={`${theme} min-h-screen bg-background text-foreground custom-scrollbar`}>
        <Navbar />
        <main className="pt-20">
          <ScrollRestoration />
          <WelcomeTutorial />
          <AnimatePresence mode="wait">
            <Routes location={location} key={location.pathname}>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/update-password" element={<UpdatePassword />} />
              <Route path="/about" element={<About />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/support" element={<Support />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/roadmap" element={<Roadmap />} />
              <Route path="/faq" element={<FAQ />} />
              <Route path="/donation" element={<Donation />} />
              <Route path="/support-us" element={<SupportUs />} />
              <Route path="/community" element={<Community />} />
              <Route path="/news" element={<News />} />
              <Route path="/news/:articleId" element={<Article />} />
              <Route path="/docs" element={<Documentation />} />
              <Route path="/tutorial" element={<TutorialPage />} />
              <Route path="/under-construction" element={<UnderConstruction />} />
              
              <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/role-dashboard" element={<ProtectedRoute><RoleDashboard /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
              
              <Route path="/services" element={<Services />} />
              <Route path="/services/bank" element={<ServiceProtectedRoute service="bank"><Bank /></ServiceProtectedRoute>} />
              <Route path="/services/business" element={<ServiceProtectedRoute service="business"><Business /></ServiceProtectedRoute>} />
              <Route path="/services/dic" element={<ServiceProtectedRoute service="dic"><DIC /></ServiceProtectedRoute>} />
              
              <Route path="/services/x" element={<ServiceProtectedRoute service="x"><SocialX /></ServiceProtectedRoute>}>
                  <Route index element={<Navigate to="feed" replace />} />
                  <Route path="feed" element={<XFeed />} />
                  <Route path="notifications" element={<XNotifications />} />
                  <Route path="messages" element={<XMessages />} />
                  <Route path="messages/:conversationId" element={<XMessages />} />
                  <Route path="search" element={<XSearch />} />
                  <Route path="profile/:handle" element={<XProfile />} />
              </Route>
              
              <Route path="/services/elections" element={<ProtectedRoute><Elections /></ProtectedRoute>} />
              <Route path="/services/political-parties" element={<ProtectedRoute><PoliticalParties /></ProtectedRoute>} />
              
              <Route path="/services/parliament" element={<ServiceAccess roleName={['Deputado', 'Senador', 'Admin']} citizenPath="/services/parliament/citizen" panelPath="/services/parliament/panel" />} />
              <Route path="/services/parliament/citizen" element={<ProtectedRoute><Parliament /></ProtectedRoute>} />
              <Route path="/services/parliament/panel" element={<RoleProtectedRoute roles={['Deputado', 'Senador', 'Admin']}><ParliamentPanel /></RoleProtectedRoute>} />

              <Route path="/services/penal-system" element={<ServiceAccess roleName={['Juiz', 'Admin']} citizenPath="/services/penal-system/citizen" panelPath="/services/penal-system/panel" />} />
              <Route path="/services/penal-system/citizen" element={<ProtectedRoute><PenalSystem /></ProtectedRoute>} />
              <Route path="/services/penal-system/panel" element={<RoleProtectedRoute roles={['Juiz', 'Admin']}><PenalSystemPanel /></RoleProtectedRoute>} />
              
              <Route path="/services/police" element={<ServiceAccess roleName="Police" citizenPath="/services/police/citizen" panelPath="/services/police/panel" />} />
              <Route path="/services/police/citizen" element={<ProtectedRoute><Police /></ProtectedRoute>} />
              <Route path="/services/police/panel" element={<RoleProtectedRoute roles={['Police', 'Admin']}><PolicePanel /></RoleProtectedRoute>} />

              <Route path="/services/agies" element={<ServiceAccess roleName="AGIES" citizenPath="/services/agies/citizen" panelPath="/services/agies/panel" />} />
              <Route path="/services/agies/citizen" element={<ProtectedRoute><AGIES /></ProtectedRoute>} />
              <Route path="/services/agies/panel" element={<RoleProtectedRoute roles={['AGIES', 'Admin']}><AGIESPanel /></RoleProtectedRoute>} />

              <Route path="/services/armed-forces" element={<ServiceAccess roleName="Forças Armadas" citizenPath="/services/armed-forces/citizen" panelPath="/services/armed-forces/panel" />} />
              <Route path="/services/armed-forces/citizen" element={<ProtectedRoute><ArmedForces /></ProtectedRoute>} />
              <Route path="/services/armed-forces/panel" element={<RoleProtectedRoute roles={['Forças Armadas', 'Admin']}><ArmedForcesPanel /></RoleProtectedRoute>} />

              <Route path="/services/library" element={<ProtectedRoute><Library /></ProtectedRoute>} />
              <Route path="/services/digital-archive" element={<ProtectedRoute><DigitalArchive /></ProtectedRoute>} />

              <Route path="/admin-dashboard" element={<AdminProtectedRoute><Navigate to="/admin-dashboard/analytics" replace /></AdminProtectedRoute>} />
              <Route path="/admin-dashboard/:tab" element={<AdminProtectedRoute><AdminDashboard /></AdminProtectedRoute>} />

              <Route path="*" element={<ErrorPage />} />
            </Routes>
          </AnimatePresence>
        </main>
        <Footer />
        <Toaster />
        <CookieConsent />
      </div>
    </AuthProvider>
  );
}

export default App;
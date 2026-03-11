import React from 'react';
import { Routes, Route, useLocation, Navigate, Link } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/contexts/AuthContext';
import Navbar from '@/components/layout/Navbar';
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
import Footer from '@/components/layout/Footer';
import FAQ from '@/pages/FAQ';
import ForgotPassword from '@/pages/ForgotPassword';
import UpdatePassword from '@/pages/UpdatePassword';
import ScrollRestoration from '@/components/ScrollRestoration';
import Community from '@/pages/Community';
import News from '@/pages/News';
import Article from '@/pages/Article';
import Documentation from '@/pages/Documentation';
import ErrorPage from '@/pages/ErrorPage';
import SupportUs from '@/pages/SupportUs';
import UnderConstruction from '@/pages/UnderConstruction';
import { AnimatePresence } from 'framer-motion';
import Dashboard from '@/pages/Dashboard';
import CitizenDashboard from '@/components/dashboard/CitizenDashboard';
import Settings from '@/pages/Settings';
import ProtectedRoute from '@/components/ProtectedRoute';
import ServiceProtectedRoute from '@/components/ServiceProtectedRoute';
import AdminDashboardPage from '@/pages/admin/AdminDashboard';
import AdminProtectedRoute from '@/components/admin/AdminProtectedRoute';
import WelcomeTutorial from '@/components/WelcomeTutorial';
import CookieConsent from '@/components/CookieConsent';
import TutorialPage from '@/pages/TutorialPage';
import DonationPage from '@/pages/DonationPage';
import CountryInfo from '@/pages/CountryInfo';
import ParticlesBackground from '@/components/ParticlesBackground';
import BetaAccessWall from '@/pages/BetaAccessWall';

import SocialX from '@/pages/services/SocialX';
import XFeed from '@/components/social-x/XFeed';
import XProfile from '@/pages/services/x/Profile';
import XNotifications from '@/pages/services/x/Notifications';
import XMessages from '@/pages/services/x/Messages';
import XSearch from '@/pages/services/x/Search';
import PostDetails from '@/pages/services/x/PostDetails';


// Governance Imports
import Elections from '@/pages/services/Elections';
import PoliticalParties from '@/pages/services/PoliticalParties';
import PartyPage from '@/pages/services/PartyPage';
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
import Prison from '@/pages/services/Prison';
import Internet from '@/pages/services/Internet';
import Electricity from '@/pages/services/Electricity';
import Water from '@/pages/services/Water';
import PhoneService from '@/pages/services/PhoneService';
import Rent from '@/pages/services/Rent';
import Maintenance from '@/pages/services/Maintenance';
import Gas from '@/pages/services/Gas';
import InventoryPage from '@/pages/services/InventoryPage';
import ProductDetails from '@/pages/services/ProductDetails';
import PresidentDashboard from '@/pages/dashboards/panels/PresidentDashboard';

const MainLayout = ({ children }) => {
  const location = useLocation();
  const isXPage = location.pathname.startsWith('/services/x');

  if (isXPage) {
    return <>{children}</>;
  }

  return (
    <>
      <Navbar />
      <main className="pt-20">
        {children}
      </main>
      <Footer />
    </>
  );
};

function App() {
  const location = useLocation();
  const { theme } = useTheme();

  return (
    <AuthProvider>
      <div className={`${theme} min-h-screen bg-background text-foreground custom-scrollbar`}>
        <ParticlesBackground />
        <div className="relative z-10">
          <MainLayout>
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
                <Route path="/country-info" element={<CountryInfo />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/support" element={<Support />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/roadmap" element={<Roadmap />} />
                <Route path="/faq" element={<FAQ />} />
                <Route path="/donation" element={<DonationPage />} />
                <Route path="/support-us" element={<SupportUs />} />
                <Route path="/community" element={<Community />} />
                <Route path="/news" element={<ServiceProtectedRoute><News /></ServiceProtectedRoute>} />
                <Route path="/news/:articleId" element={<ServiceProtectedRoute><Article /></ServiceProtectedRoute>} />
                <Route path="/docs" element={<Documentation />} />
                <Route path="/tutorial" element={<TutorialPage />} />
                <Route path="/under-construction" element={<UnderConstruction />} />
                <Route path="/beta-access" element={<BetaAccessWall />} />
                
                <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                <Route path="/dashboard/citizen" element={<ProtectedRoute><CitizenDashboard /></ProtectedRoute>} />
                <Route path="/role-dashboard" element={<ProtectedRoute><RoleDashboard /></ProtectedRoute>} />
                <Route path="/dashboard/president" element={<RoleProtectedRoute roles={['Presidente', 'Admin']}><PresidentDashboard /></RoleProtectedRoute>} />
                <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
                
                <Route path="/services" element={<ServiceProtectedRoute><Services /></ServiceProtectedRoute>} />
                <Route path="/services/bank" element={<ServiceProtectedRoute><Bank /></ServiceProtectedRoute>} />
                <Route path="/services/business" element={<ServiceProtectedRoute><Business /></ServiceProtectedRoute>} />
                <Route path="/services/business/product/:productId" element={<ServiceProtectedRoute><ProductDetails /></ServiceProtectedRoute>} />
                <Route path="/services/inventory" element={<ServiceProtectedRoute><InventoryPage /></ServiceProtectedRoute>} />
                <Route path="/services/dic" element={<ServiceProtectedRoute><DIC /></ServiceProtectedRoute>} />
                <Route path="/services/prison" element={<ServiceProtectedRoute><Prison /></ServiceProtectedRoute>} />
                
                <Route path="/services/x" element={<ServiceProtectedRoute><SocialX /></ServiceProtectedRoute>}>
                    <Route index element={<Navigate to="feed" replace />} />
                    <Route path="feed" element={<XFeed />} />
                    <Route path="post/:postId" element={<PostDetails />} />
                    <Route path="notifications" element={<XNotifications />} />
                    <Route path="messages" element={<XMessages />} />
                    <Route path="messages/:conversationId" element={<XMessages />} />
                    <Route path="search" element={<XSearch />} />
                    <Route path="profile/:handle" element={<XProfile />} />
                </Route>
                
                <Route path="/services/elections" element={<ServiceProtectedRoute><Elections /></ServiceProtectedRoute>} />

                <Route path="/services/political-parties" element={<ServiceProtectedRoute><PoliticalParties /></ServiceProtectedRoute>} />
                <Route path="/services/political-parties/:partyId" element={<ServiceProtectedRoute><PartyPage /></ServiceProtectedRoute>} />
                
                <Route path="/services/parliament" element={<ServiceProtectedRoute><ServiceAccess requiredRoles={['Deputado', 'Senador', 'Presidente da Câmara', 'Presidente do Senado', 'Admin']} citizenPath="/services/parliament/citizen" panelPath="/services/parliament/panel" /></ServiceProtectedRoute>} />
                <Route path="/services/parliament/citizen" element={<ServiceProtectedRoute><Parliament /></ServiceProtectedRoute>} />
                <Route path="/services/parliament/panel" element={<RoleProtectedRoute roles={['Deputado', 'Senador', 'Presidente da Câmara', 'Presidente do Senado', 'Admin']}><ParliamentPanel /></RoleProtectedRoute>} />

                <Route path="/services/penal-system" element={<ServiceProtectedRoute><ServiceAccess requiredRoles={['Juiz', 'Admin']} citizenPath="/services/penal-system/citizen" panelPath="/services/penal-system/panel" /></ServiceProtectedRoute>} />
                <Route path="/services/penal-system/citizen" element={<ServiceProtectedRoute><PenalSystem /></ServiceProtectedRoute>} />
                <Route path="/services/penal-system/panel" element={<RoleProtectedRoute roles={['Juiz', 'Admin']}><PenalSystemPanel /></RoleProtectedRoute>} />
                
                <Route path="/services/police" element={<ServiceProtectedRoute><ServiceAccess requiredRoles={['Policial', 'Admin']} citizenPath="/services/police/citizen" panelPath="/services/police/panel" /></ServiceProtectedRoute>} />
                <Route path="/services/police/citizen" element={<ServiceProtectedRoute><Police /></ServiceProtectedRoute>} />
                <Route path="/services/police/panel" element={<RoleProtectedRoute roles={['Policial', 'Admin']}><PolicePanel /></RoleProtectedRoute>} />

                <Route path="/services/agies" element={<ServiceProtectedRoute><ServiceAccess requiredRoles={['Agente Secreto', 'Admin']} citizenPath="/services/agies/citizen" panelPath="/services/agies/panel" /></ServiceProtectedRoute>} />
                <Route path="/services/agies/citizen" element={<ServiceProtectedRoute><AGIES /></ServiceProtectedRoute>} />
                <Route path="/services/agies/panel" element={<RoleProtectedRoute roles={['Agente Secreto', 'Admin']}><AGIESPanel /></RoleProtectedRoute>} />

                <Route path="/services/armed-forces" element={<ServiceProtectedRoute><ServiceAccess requiredRoles={['Militar', 'Admin']} citizenPath="/services/armed-forces/citizen" panelPath="/services/armed-forces/panel" /></ServiceProtectedRoute>} />
                <Route path="/services/armed-forces/citizen" element={<ServiceProtectedRoute><ArmedForces /></ServiceProtectedRoute>} />
                <Route path="/services/armed-forces/panel" element={<RoleProtectedRoute roles={['Militar', 'Admin']}><ArmedForcesPanel /></RoleProtectedRoute>} />

                <Route path="/services/library" element={<ServiceProtectedRoute><Library /></ServiceProtectedRoute>} />
                <Route path="/services/digital-archive" element={<ServiceProtectedRoute><DigitalArchive /></ServiceProtectedRoute>} />
                
                <Route path="/services/internet" element={<ServiceProtectedRoute><Internet /></ServiceProtectedRoute>} />
                <Route path="/services/electricity" element={<ServiceProtectedRoute><Electricity /></ServiceProtectedRoute>} />
                <Route path="/services/water" element={<ServiceProtectedRoute><Water /></ServiceProtectedRoute>} />
                <Route path="/services/phone" element={<ServiceProtectedRoute><PhoneService /></ServiceProtectedRoute>} />
                <Route path="/services/rent" element={<ServiceProtectedRoute><Rent /></ServiceProtectedRoute>} />
                <Route path="/services/maintenance" element={<ServiceProtectedRoute><Maintenance /></ServiceProtectedRoute>} />
                <Route path="/services/gas" element={<ServiceProtectedRoute><Gas /></ServiceProtectedRoute>} />

                <Route path="/admin-dashboard" element={<AdminProtectedRoute><AdminDashboardPage /></AdminProtectedRoute>} />
                <Route path="/admin-dashboard/:tab" element={<AdminProtectedRoute><AdminDashboardPage /></AdminProtectedRoute>} />

                <Route path="*" element={<ErrorPage />} />
              </Routes>
            </AnimatePresence>
          </MainLayout>
          <Toaster />
          <CookieConsent />
        </div>
      </div>
    </AuthProvider>
  );
}

export default App;
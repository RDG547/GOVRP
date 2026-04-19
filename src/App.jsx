import React from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import Navbar from '@/components/layout/Navbar';
import Home from '@/pages/Home';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import AuthCallback from '@/pages/AuthCallback';
import About from '@/pages/About';
import Contact from '@/pages/Contact';
import AccountDeletion from '@/pages/AccountDeletion';
import Support from '@/pages/Support';
import Terms from '@/pages/Terms';
import Privacy from '@/pages/Privacy';
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
import ComingSoon from '@/pages/ComingSoon';
import MaintenanceMode from '@/pages/MaintenanceMode';
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
import ScrollToTop from '@/components/ScrollToTop';
import DailyCheckInPopup from '@/components/DailyCheckInPopup';
import ElectionOfficeAwardPopup from '@/components/ElectionOfficeAwardPopup';
import SalaryPaymentPopup from '@/components/SalaryPaymentPopup';
import { InternetSpeedProvider } from '@/contexts/InternetSpeedContext';

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
import Education from '@/pages/services/Education';
import InventoryPage from '@/pages/services/InventoryPage';
import ProductDetails from '@/pages/services/ProductDetails';
import PresidentDashboard from '@/pages/dashboards/panels/PresidentDashboard';
import PrisonRouteGuard from '@/components/PrisonRouteGuard';
import { isPrisonSentenceActive } from '@/lib/prison';
import { PARLIAMENT_PANEL_ROLES } from '@/lib/parliament';
import ServiceAvailabilityGate from '@/components/ServiceAvailabilityGate';
import EntrepreneurPortal from '@/pages/services/EntrepreneurPortal';

const MainLayout = ({ children }) => {
  const location = useLocation();
  const { user } = useAuth();
  const isXPage = location.pathname.startsWith('/services/x');
  const isAuthCallback = location.pathname === '/auth/callback';
  const isLockedPrisonPage =
    isPrisonSentenceActive(user) && location.pathname === '/services/prison';

  if (isAuthCallback || isLockedPrisonPage) {
    return <>{children}</>;
  }

  return (
    <>
      <Navbar />
      <main className={isXPage ? "pt-20 w-full" : "pt-20"}>
        {children}
      </main>
      {!isXPage && <Footer disableTopSpacing={location.pathname === '/'} />}
      <ScrollToTop />
    </>
  );
};

const ManagedServiceRoute = ({ serviceKey, children }) => (
  <ServiceProtectedRoute>
    <ServiceAvailabilityGate serviceKey={serviceKey}>
      {children}
    </ServiceAvailabilityGate>
  </ServiceProtectedRoute>
);

function App() {
  const location = useLocation();
  const { theme } = useTheme();
  const isAuthCallback = location.pathname === '/auth/callback';

  return (
    <AuthProvider>
      <div className={`${theme} min-h-screen bg-background text-foreground custom-scrollbar`}>
        {!isAuthCallback && <ParticlesBackground />}
        <div className="relative z-10">
          <PrisonRouteGuard>
            <InternetSpeedProvider>
            <MainLayout>
              <ScrollRestoration />
              {!isAuthCallback && <WelcomeTutorial />}
              <AnimatePresence mode="wait">
                <Routes location={location} key={location.pathname.startsWith('/services/x') ? '/services/x' : location.pathname}>
                <Route path="/" element={<Home />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/auth/callback" element={<AuthCallback />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/update-password" element={<UpdatePassword />} />
                <Route path="/about" element={<About />} />
                <Route path="/country-info" element={<CountryInfo />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/account-deletion" element={<AccountDeletion />} />
                <Route path="/support" element={<Support />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/faq" element={<FAQ />} />
                <Route path="/donation" element={<DonationPage />} />
                <Route path="/support-us" element={<SupportUs />} />
                <Route path="/community" element={<Community />} />
                <Route path="/news" element={<ServiceProtectedRoute><News /></ServiceProtectedRoute>} />
                <Route path="/news/:articleId" element={<ServiceProtectedRoute><Article /></ServiceProtectedRoute>} />
                <Route path="/docs" element={<Documentation />} />
                <Route path="/tutorial" element={<TutorialPage />} />
                <Route path="/under-construction" element={<UnderConstruction />} />
                <Route path="/coming-soon" element={<ComingSoon />} />
                <Route path="/maintenance" element={<MaintenanceMode />} />
                <Route path="/beta-access" element={<BetaAccessWall />} />
                
                <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                <Route path="/dashboard/citizen" element={<ProtectedRoute><CitizenDashboard /></ProtectedRoute>} />
                <Route path="/role-dashboard" element={<ProtectedRoute><RoleDashboard /></ProtectedRoute>} />
                <Route path="/dashboard/president" element={<RoleProtectedRoute roles={['Presidente', 'Admin']}><PresidentDashboard /></RoleProtectedRoute>} />
                <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
                
                <Route path="/services" element={<ServiceProtectedRoute><Services /></ServiceProtectedRoute>} />
                <Route path="/services/bank" element={<ManagedServiceRoute serviceKey="/services/bank"><Bank /></ManagedServiceRoute>} />
                <Route path="/services/business" element={<ManagedServiceRoute serviceKey="/services/business"><Business /></ManagedServiceRoute>} />
                <Route path="/services/business/product/:productId" element={<ManagedServiceRoute serviceKey="/services/business"><ProductDetails /></ManagedServiceRoute>} />
                <Route path="/services/inventory" element={<ManagedServiceRoute serviceKey="/services/business"><InventoryPage /></ManagedServiceRoute>} />
                <Route path="/services/dic" element={<ManagedServiceRoute serviceKey="/services/dic"><DIC /></ManagedServiceRoute>} />
                <Route path="/services/prison" element={<ManagedServiceRoute serviceKey="/services/prison"><Prison /></ManagedServiceRoute>} />
                <Route path="/services/entrepreneur-portal" element={<ManagedServiceRoute serviceKey="/services/entrepreneur-portal"><EntrepreneurPortal /></ManagedServiceRoute>} />
                
                <Route path="/services/x" element={<ManagedServiceRoute serviceKey="/services/x"><SocialX /></ManagedServiceRoute>}>
                    <Route index element={<Navigate to="feed" replace />} />
                    <Route path="feed" element={<XFeed />} />
                    <Route path="post/:postId" element={<PostDetails />} />
                    <Route path="notifications" element={<XNotifications />} />
                    <Route path="messages" element={<XMessages />} />
                    <Route path="messages/:conversationId" element={<XMessages />} />
                    <Route path="search" element={<XSearch />} />
                    <Route path="profile/:handle" element={<XProfile />} />
                </Route>
                
                <Route path="/services/elections" element={<ManagedServiceRoute serviceKey="/services/elections"><Elections /></ManagedServiceRoute>} />

                <Route path="/services/political-parties" element={<ManagedServiceRoute serviceKey="/services/political-parties"><PoliticalParties /></ManagedServiceRoute>} />
                <Route path="/services/political-parties/:partyId" element={<ManagedServiceRoute serviceKey="/services/political-parties"><PartyPage /></ManagedServiceRoute>} />
                
                <Route path="/services/parliament" element={<ManagedServiceRoute serviceKey="/services/parliament"><ServiceAccess requiredRoles={PARLIAMENT_PANEL_ROLES} citizenPath="/services/parliament/citizen" panelPath="/services/parliament/panel" /></ManagedServiceRoute>} />
                <Route path="/services/parliament/citizen" element={<ManagedServiceRoute serviceKey="/services/parliament"><Parliament /></ManagedServiceRoute>} />
                <Route path="/services/parliament/panel" element={<ManagedServiceRoute serviceKey="/services/parliament"><RoleProtectedRoute roles={PARLIAMENT_PANEL_ROLES}><ParliamentPanel /></RoleProtectedRoute></ManagedServiceRoute>} />

                <Route path="/services/penal-system" element={<ManagedServiceRoute serviceKey="/services/penal-system"><ServiceAccess requiredRoles={['Juiz', 'Admin']} citizenPath="/services/penal-system/citizen" panelPath="/services/penal-system/panel" /></ManagedServiceRoute>} />
                <Route path="/services/penal-system/citizen" element={<ManagedServiceRoute serviceKey="/services/penal-system"><PenalSystem /></ManagedServiceRoute>} />
                <Route path="/services/penal-system/panel" element={<ManagedServiceRoute serviceKey="/services/penal-system"><RoleProtectedRoute roles={['Juiz', 'Admin']}><PenalSystemPanel /></RoleProtectedRoute></ManagedServiceRoute>} />
                
                <Route path="/services/police" element={<ManagedServiceRoute serviceKey="/services/police"><ServiceAccess requiredRoles={['Policial', 'Admin']} citizenPath="/services/police/citizen" panelPath="/services/police/panel" /></ManagedServiceRoute>} />
                <Route path="/services/police/citizen" element={<ManagedServiceRoute serviceKey="/services/police"><Police /></ManagedServiceRoute>} />
                <Route path="/services/police/panel" element={<ManagedServiceRoute serviceKey="/services/police"><RoleProtectedRoute roles={['Policial', 'Admin']}><PolicePanel /></RoleProtectedRoute></ManagedServiceRoute>} />

                <Route path="/services/agies" element={<ManagedServiceRoute serviceKey="/services/agies"><ServiceAccess requiredRoles={['Agente Secreto', 'Admin']} citizenPath="/services/agies/citizen" panelPath="/services/agies/panel" /></ManagedServiceRoute>} />
                <Route path="/services/agies/citizen" element={<ManagedServiceRoute serviceKey="/services/agies"><AGIES /></ManagedServiceRoute>} />
                <Route path="/services/agies/panel" element={<ManagedServiceRoute serviceKey="/services/agies"><RoleProtectedRoute roles={['Agente Secreto', 'Admin']}><AGIESPanel /></RoleProtectedRoute></ManagedServiceRoute>} />

                <Route path="/services/armed-forces" element={<ManagedServiceRoute serviceKey="/services/armed-forces"><ServiceAccess requiredRoles={['Militar', 'Admin']} citizenPath="/services/armed-forces/citizen" panelPath="/services/armed-forces/panel" /></ManagedServiceRoute>} />
                <Route path="/services/armed-forces/citizen" element={<ManagedServiceRoute serviceKey="/services/armed-forces"><ArmedForces /></ManagedServiceRoute>} />
                <Route path="/services/armed-forces/panel" element={<ManagedServiceRoute serviceKey="/services/armed-forces"><RoleProtectedRoute roles={['Militar', 'Admin']}><ArmedForcesPanel /></RoleProtectedRoute></ManagedServiceRoute>} />

                <Route path="/services/library" element={<ManagedServiceRoute serviceKey="/services/library"><Library /></ManagedServiceRoute>} />
                <Route path="/services/digital-archive" element={<ManagedServiceRoute serviceKey="/services/digital-archive"><DigitalArchive /></ManagedServiceRoute>} />
                
                <Route path="/services/internet" element={<ManagedServiceRoute serviceKey="/services/internet"><Internet /></ManagedServiceRoute>} />
                <Route path="/services/electricity" element={<ManagedServiceRoute serviceKey="/services/electricity"><Electricity /></ManagedServiceRoute>} />
                <Route path="/services/water" element={<ManagedServiceRoute serviceKey="/services/water"><Water /></ManagedServiceRoute>} />
                <Route path="/services/phone" element={<ManagedServiceRoute serviceKey="/services/phone"><PhoneService /></ManagedServiceRoute>} />
                <Route path="/services/rent" element={<ManagedServiceRoute serviceKey="/services/rent"><Rent /></ManagedServiceRoute>} />
                <Route path="/services/maintenance" element={<ManagedServiceRoute serviceKey="/services/maintenance"><Maintenance /></ManagedServiceRoute>} />
                <Route path="/services/gas" element={<ManagedServiceRoute serviceKey="/services/gas"><Gas /></ManagedServiceRoute>} />
                <Route path="/services/education" element={<ManagedServiceRoute serviceKey="/services/education"><Education /></ManagedServiceRoute>} />

                <Route path="/admin-dashboard" element={<AdminProtectedRoute><AdminDashboardPage /></AdminProtectedRoute>} />
                <Route path="/admin-dashboard/:tab" element={<AdminProtectedRoute><AdminDashboardPage /></AdminProtectedRoute>} />

                <Route path="*" element={<ErrorPage />} />
                </Routes>
              </AnimatePresence>
            </MainLayout>
            </InternetSpeedProvider>
          </PrisonRouteGuard>
          <Toaster />
          {!isAuthCallback && <CookieConsent />}
          {!isAuthCallback && <DailyCheckInPopup />}
          {!isAuthCallback && <SalaryPaymentPopup />}
          {!isAuthCallback && <ElectionOfficeAwardPopup />}
        </div>
      </div>
    </AuthProvider>
  );
}

export default App;

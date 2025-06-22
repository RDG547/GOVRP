import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, User, LogOut, ChevronDown, Settings, LayoutDashboard, Landmark, Briefcase, FileText, Library, Bot, MessageSquare, Users, Newspaper, Home as HomeIcon, Heart, HelpCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { useToast } from './ui/use-toast';
import NotificationBell from './NotificationBell';

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [isServicesClicked, setIsServicesClicked] = useState(false);
  const [isUserMenuClicked, setIsUserMenuClicked] = useState(false);

  const { user, logout, session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();

  const servicesTimeoutRef = useRef(null);
  const userMenuTimeoutRef = useRef(null);
  const navRef = useRef(null);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll);
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (navRef.current && !navRef.current.contains(event.target)) {
        setIsServicesClicked(false);
        setServicesOpen(false);
        setIsUserMenuClicked(false);
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [navRef]);

  useEffect(() => {
    setIsOpen(false);
    setIsServicesClicked(false);
    setServicesOpen(false);
    setIsUserMenuClicked(false);
    setUserMenuOpen(false);
  }, [location]);

  const services = [
    { name: 'Banco Nacional', path: '/services/bank', icon: <Landmark className="w-5 h-5 text-green-400"/> },
    { name: 'Negócios Livres', path: '/services/business', icon: <Briefcase className="w-5 h-5 text-blue-400"/> },
    { name: 'DIC', path: '/services/dic', icon: <FileText className="w-5 h-5 text-purple-400"/> },
    { name: 'X', path: '/services/x', icon: <MessageSquare className="w-5 h-5 text-sky-400"/> },
    { name: 'Biblioteca Nacional', path: '/services/library', icon: <Library className="w-5 h-5 text-orange-400"/> },
    { name: 'Acervo Digital', path: '/services/digital-archive', icon: <Bot className="w-5 h-5 text-rose-400"/> }
  ];

  const mainLinks = [
      { name: 'Início', path: '/', icon: HomeIcon },
      { name: 'Serviços', path: '/#services-section', icon: LayoutDashboard, isDropdown: true },
      { name: 'Comunidade', path: '/community', icon: Users },
      { name: 'Notícias', path: '/news', icon: Newspaper },
      { name: 'Apoie o Projeto', path: '/support-us', icon: Heart },
      { name: 'Ajuda', path: '/contact', icon: HelpCircle },
  ];

  const handleLogout = async () => {
    await logout();
    toast({ title: 'Você saiu da sua conta.' });
    navigate('/');
  };
  
  const handleServicesEnter = () => { clearTimeout(servicesTimeoutRef.current); setServicesOpen(true); };
  const handleServicesLeave = () => { if (!isServicesClicked) { servicesTimeoutRef.current = setTimeout(() => setServicesOpen(false), 200); } };
  const handleServicesClick = (e) => {
    e.preventDefault();
    if(location.pathname === '/') {
        document.getElementById('services-section')?.scrollIntoView({ behavior: 'smooth' });
    } else {
        navigate('/#services-section');
    }
    setIsServicesClicked(prev => !prev);
    if (!servicesOpen) setServicesOpen(true);
  };

  const handleUserMenuEnter = () => { clearTimeout(userMenuTimeoutRef.current); setUserMenuOpen(true); };
  const handleUserMenuLeave = () => { if (!isUserMenuClicked) { userMenuTimeoutRef.current = setTimeout(() => setUserMenuOpen(false), 200); } };
  const handleUserMenuClick = () => { setIsUserMenuClicked(prev => !prev); if (!userMenuOpen) setUserMenuOpen(true); };

  const NavLink = ({ to, children, className, icon: Icon, onClick }) => (
    <Link to={to} onClick={onClick} className={`flex items-center gap-2 relative text-white hover:text-blue-300 transition-colors duration-300 ${className}`}>
      {Icon && <Icon className="w-4 h-4"/>}
      {children}
      {location.pathname === to && (
        <motion.div className="absolute -bottom-2 left-0 right-0 h-0.5 bg-blue-400" layoutId="underline" initial={false} transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
      )}
    </Link>
  );

  return (
    <motion.nav ref={navRef} initial={{ y: -100 }} animate={{ y: 0 }} transition={{ duration: 0.5, ease: 'easeOut' }} className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${isScrolled || isOpen ? 'bg-slate-900/80 backdrop-blur-xl border-b border-white/10' : 'bg-transparent'}`}>
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-20">
          <Link to="/" className="flex items-center space-x-2"><motion.div whileHover={{ scale: 1.1, rotate: -5 }} className="text-3xl font-bold gradient-text">GOV.RP</motion.div></Link>

          <div className="hidden md:flex items-center space-x-8">
            <NavLink to="/" icon={HomeIcon}>Início</NavLink>
            <div className="relative" onMouseEnter={handleServicesEnter} onMouseLeave={handleServicesLeave}>
              <a href="#services-section" onClick={handleServicesClick} className="flex items-center space-x-1 text-white hover:text-blue-300 transition-colors cursor-pointer"><LayoutDashboard className="w-4 h-4" /><span>Serviços</span><ChevronDown className={`w-4 h-4 transition-transform ${servicesOpen ? 'rotate-180' : ''}`} /></a>
              <AnimatePresence>
                {servicesOpen && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute top-full left-1/2 -translate-x-1/2 mt-4 w-72 bg-slate-800/90 backdrop-blur-lg border border-white/10 rounded-lg shadow-2xl p-2">
                    {services.map((s) => (<Link key={s.path} to={s.path} className="flex items-center space-x-3 px-4 py-3 hover:bg-white/10 transition-colors rounded-md text-white"><div className="flex-shrink-0">{s.icon}</div><span>{s.name}</span></Link>))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <NavLink to="/community" icon={Users}>Comunidade</NavLink>
            <NavLink to="/news" icon={Newspaper}>Notícias</NavLink>
            <NavLink to="/support-us" icon={Heart}>Apoie o Projeto</NavLink>
            <NavLink to="/contact" icon={HelpCircle}>Ajuda</NavLink>
          </div>

          <div className="hidden md:flex items-center space-x-4">
            {session ? (
              <>
                <NotificationBell />
                <div className="relative" onMouseEnter={handleUserMenuEnter} onMouseLeave={handleUserMenuLeave}>
                  <button onClick={handleUserMenuClick} className="flex items-center space-x-2 text-white hover:text-blue-300 transition-colors">
                    <img src={user?.avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${user?.username}`} alt="Avatar" className="w-8 h-8 rounded-full object-cover bg-white/10"/>
                    <span className="font-medium">{user?.username}</span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {userMenuOpen && (
                      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute top-full right-0 mt-4 w-56 bg-slate-800/90 backdrop-blur-lg border border-white/10 rounded-lg shadow-2xl py-2">
                        <div className="px-4 py-2 border-b border-white/10"><p className="text-sm text-gray-400">Logado como</p><p className="text-white font-semibold truncate">{user?.full_name}</p></div>
                        <Link to="/dashboard" className="flex items-center space-x-3 w-full px-4 py-3 hover:bg-white/10 transition-colors text-white"><LayoutDashboard className="w-5 h-5 text-blue-400" /><span>Dashboard</span></Link>
                        <Link to="/settings" className="flex items-center space-x-3 w-full px-4 py-3 hover:bg-white/10 transition-colors text-white"><Settings className="w-5 h-5 text-gray-400" /><span>Configurações</span></Link>
                        <button onClick={handleLogout} className="flex items-center space-x-3 w-full px-4 py-3 hover:bg-white/10 transition-colors text-red-400"><LogOut className="w-5 h-5" /><span>Sair</span></button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            ) : (
              <>
                <Link to="/login"><Button variant="ghost" className="text-white hover:bg-white/10 hover:text-white">Entrar</Button></Link>
                <Link to="/register"><Button className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">Cadastrar</Button></Link>
              </>
            )}
          </div>
          
          <button onClick={() => setIsOpen(!isOpen)} className="md:hidden text-white hover:text-blue-400 transition-colors z-10">{isOpen ? <X className="w-7 h-7" /> : <Menu className="w-7 h-7" />}</button>
        </div>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="md:hidden bg-slate-900/95 backdrop-blur-lg absolute top-0 left-0 w-full h-screen">
            <motion.div initial={{ y: "-100%" }} animate={{ y: 0 }} exit={{ y: "-100%" }} transition={{ type: "spring", stiffness: 300, damping: 30 }} className="px-4 pt-24 pb-8 space-y-4 flex flex-col h-full">
              {mainLinks.map(link => link.isDropdown ? null : <NavLink key={link.path} to={link.path} icon={link.icon} className="text-lg p-2">{link.name}</NavLink>)}
              <div className="space-y-2 pt-4 border-t border-white/10"><p className="text-gray-400 font-medium px-2">Serviços</p>{services.map((s) => (<Link key={s.path} to={s.path} className="flex items-center space-x-3 pl-4 pr-2 py-2 text-white hover:bg-white/10 rounded-md transition-colors"><span className="text-xl">{s.icon}</span><span>{s.name}</span></Link>))}</div>
              <div className="space-y-2 pt-4 border-t border-white/10"><NavLink to="/support-us" icon={Heart} className="text-lg p-2">Apoie o Projeto</NavLink><NavLink to="/contact" icon={HelpCircle} className="text-lg p-2">Ajuda</NavLink></div>
              <div className="mt-auto pt-4 border-t border-white/10">
                {session ? (
                  <><p className="text-gray-400 px-4 mb-2">Logado como {user?.full_name}</p><Link to="/dashboard" className="flex items-center gap-2 px-4 py-2 text-white hover:bg-white/10 rounded-md"><LayoutDashboard className="w-4 h-4"/> <span>Dashboard</span></Link><button onClick={handleLogout} className="flex items-center gap-2 w-full px-4 py-2 text-red-400 hover:bg-white/10 rounded-md"><LogOut className="w-4 h-4" /> <span>Sair</span></button></>
                ) : (
                  <div className="space-y-2"><Link to="/login" className="block w-full text-center"><Button variant="outline" className="w-full border-white/20 text-white">Entrar</Button></Link><Link to="/register" className="block w-full text-center"><Button className="w-full bg-gradient-to-r from-blue-600 to-purple-600">Cadastrar</Button></Link></div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
};

export default Navbar;